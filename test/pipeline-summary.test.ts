import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { auditMarker, auditRowsSince } from './audit.js';
import { connectAsAdmin, connectAsApp, PERMISSION_DENIED, SEED_STAFF } from './db.js';
import { connectMcpClient, textOf, type McpSession } from './mcp.js';

const app = connectAsApp();
const admin = connectAsAdmin();
let leadership: McpSession;
let counsellor: McpSession;

const MIN_DAYS = 5;
const SEED_INQUIRIES_PER_CAMPUS = 20;
const SEED_CAMPUSES = 3;

beforeAll(async () => {
  leadership = await connectMcpClient(app, SEED_STAFF.leadership);
  counsellor = await connectMcpClient(app, SEED_STAFF.erbilCounsellor);
});

afterAll(async () => {
  await Promise.all([leadership.close(), counsellor.close()]);
  await Promise.all([app.end(), admin.end()]);
});

interface StageCount {
  stage: string;
  inquiryCount: number;
  staleCount: number;
}

/** The expected summary, counted as admin straight from the tables, every stage zero-filled. */
async function expectedSummary(campusId: string | null, minDays: number) {
  const byStage = await admin<StageCount[]>`
    select
      s.stage::text as stage,
      count(ia.inquiry_id)::int as "inquiryCount",
      (count(ia.inquiry_id) filter (
        where s.stage not in ('enrolled', 'withdrawn', 'lost') and ia.days_since_contact >= ${minDays}
      ))::int as "staleCount"
    from unnest(enum_range(null::inquiry_stage)) as s (stage)
    left join inquiry_activity ia on ia.stage = s.stage and (${campusId}::text is null or ia.campus_id = ${campusId})
    group by s.stage
    order by s.stage
  `;
  const terminal = new Set(['enrolled', 'withdrawn', 'lost']);
  return {
    campus: campusId,
    minDaysWithoutContact: minDays,
    byStage: [...byStage],
    activeTotal: byStage.filter((r) => !terminal.has(r.stage)).reduce((n, r) => n + r.inquiryCount, 0),
    staleCount: byStage.reduce((n, r) => n + r.staleCount, 0),
  };
}

/** Every id and personal name in the database: none may appear in a summary. */
async function individualIdentifiers(): Promise<string[]> {
  const rows = await admin<{ value: string }[]>`
    select id::text as value from inquiries
    union select id::text from applicants
    union select id::text from guardians
    union select id::text from staff
    union select first_name from applicants
    union select last_name from applicants
    union select full_name from guardians
    union select full_name from staff
  `;
  return rows.map((r) => r.value);
}

function callSummary(session: McpSession, args: Record<string, unknown>) {
  return session.client.callTool({ name: 'pipeline_summary', arguments: args });
}

describe('pipeline_summary as leadership', () => {
  it('summarises every campus with the seed counts, and contains no names or ids', async () => {
    const result = await callSummary(leadership, {});

    expect(result.isError).toBeFalsy();
    const expected = await expectedSummary(null, MIN_DAYS);
    expect(result.structuredContent).toEqual(expected);
    expect(expected.byStage.reduce((n, r) => n + r.inquiryCount, 0)).toBe(SEED_INQUIRIES_PER_CAMPUS * SEED_CAMPUSES);
    expect(expected.staleCount).toBeGreaterThan(0);

    const output = JSON.stringify([result.content, result.structuredContent]);
    for (const identifier of await individualIdentifiers()) {
      expect(output, identifier).not.toContain(identifier);
    }
  });

  it('summarises one campus when asked', async () => {
    const result = await callSummary(leadership, { campus: 'dubai' });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(await expectedSummary('dubai', MIN_DAYS));
  });

  it('refuses an unknown campus', async () => {
    const result = await callSummary(leadership, { campus: 'atlantis' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unknown campus "atlantis"');
  });
});

describe('pipeline_summary as a counsellor', () => {
  it('summarises their own campus', async () => {
    const result = await callSummary(counsellor, { min_days_without_contact: 6 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(await expectedSummary('erbil', 6));
  });

  it('is denied another campus, and the denial is audited', async () => {
    const marker = await auditMarker(admin);
    const result = await callSummary(counsellor, { campus: 'dubai' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('can only summarise your own campus');
    expect(result.structuredContent).toBeUndefined();
    expect(await auditRowsSince(admin, marker)).toMatchObject([
      { tool_name: 'pipeline_summary', arguments: { campus: 'dubai' }, outcome: 'denied', result_count: null },
    ]);
  });
});

describe('pipeline_summary database function', () => {
  async function callFunctionAs(staffSetting: string | null, campusId: string | null): Promise<postgres.Row[]> {
    return app.begin(async (tx) => {
      if (staffSetting !== null) {
        await tx`select set_config('app.staff_id', ${staffSetting}, true)`;
      }
      return [...(await tx`select * from pipeline_summary(${campusId}, ${MIN_DAYS})`)];
    });
  }

  // Skips the tool's campus check, as if it had a bug: the function alone must refuse.
  it('refuses a counsellor another campus on its own', async () => {
    await expect(callFunctionAs(SEED_STAFF.erbilCounsellor, 'dubai')).rejects.toMatchObject({ code: PERMISSION_DENIED });
  });

  it.each([
    { label: 'unset', setting: null },
    { label: 'unknown staff id', setting: '00000000-0000-0000-0000-00000000ffff' },
    { label: 'malformed staff id', setting: 'not-a-uuid' },
  ])('fails closed with no identity ($label)', async ({ setting }) => {
    await expect(callFunctionAs(setting, null)).rejects.toMatchObject({ code: PERMISSION_DENIED });
  });

  it.each(['anon', 'authenticated', 'public'])('cannot be executed by %s', async (role) => {
    const [row] = await admin<{ allowed: boolean }[]>`
      select has_function_privilege(${role}, 'pipeline_summary(text, integer)', 'execute') as allowed
    `;
    expect(row?.allowed).toBe(false);
  });
});
