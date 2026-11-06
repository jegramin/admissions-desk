import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NOT_FOUND_MESSAGE } from '../src/tools/get-inquiry.js';
import { auditMarker, auditRowsSince } from './audit.js';
import { connectAsAdmin, connectAsApp, SEED_INQUIRY, SEED_STAFF } from './db.js';
import { connectMcpClient, textOf, type McpSession } from './mcp.js';

const app = connectAsApp();
const admin = connectAsAdmin();
let counsellor: McpSession;
let leadership: McpSession;

/** Distinctive, so its absence from the audit log is a meaningful assertion. */
const NOTE = 'Spoke with Elias Steiner about the assessment date; call back on +1-555-0105.';

const StaleIdsSchema = z.object({ inquiries: z.array(z.object({ inquiryId: z.string() })) });

beforeAll(async () => {
  counsellor = await connectMcpClient(app, SEED_STAFF.erbilCounsellor);
  leadership = await connectMcpClient(app, SEED_STAFF.leadership);
});

afterAll(async () => {
  await Promise.all([counsellor.close(), leadership.close()]);
  await Promise.all([app.end(), admin.end()]);
});

function logFollowup(session: McpSession, inquiryId: string) {
  return session.client.callTool({
    name: 'log_followup',
    arguments: { inquiry_id: inquiryId, channel: 'phone', note: NOTE },
  });
}

async function staleIds(session: McpSession): Promise<string[]> {
  const result = await session.client.callTool({ name: 'find_stale_inquiries', arguments: {} });
  return StaleIdsSchema.parse(result.structuredContent).inquiries.map((i) => i.inquiryId);
}

async function followupCount(inquiryId: string): Promise<number> {
  const [row] = await admin<{ n: number }[]>`select count(*)::int as n from followups where inquiry_id = ${inquiryId}`;
  return row?.n ?? 0;
}

describe('log_followup on an own-campus inquiry', () => {
  it('records the followup, resets staleness, and drops it from find_stale_inquiries', async () => {
    expect(await staleIds(counsellor)).toContain(SEED_INQUIRY.erbilStale);
    const marker = await auditMarker(admin);

    const result = await logFollowup(counsellor, SEED_INQUIRY.erbilStale);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      inquiryId: SEED_INQUIRY.erbilStale,
      applicantName: 'Emma Steiner',
      channel: 'phone',
      daysSinceContact: 0,
    });
    expect(textOf(result)).toContain('Days since contact is now 0');

    const [stored] = await admin<{ staff_id: string; channel: string; note: string }[]>`
      select staff_id, channel, note from followups where inquiry_id = ${SEED_INQUIRY.erbilStale}
      order by created_at desc limit 1
    `;
    expect(stored).toEqual({ staff_id: SEED_STAFF.erbilCounsellor, channel: 'phone', note: NOTE });

    expect(await staleIds(counsellor)).not.toContain(SEED_INQUIRY.erbilStale);

    const auditRows = await auditRowsSince(admin, marker);
    expect(auditRows.filter((row) => row.tool_name === 'log_followup')).toEqual([{
      staff_id: SEED_STAFF.erbilCounsellor,
      tool_name: 'log_followup',
      arguments: { inquiry_id: SEED_INQUIRY.erbilStale, channel: 'phone' },
      outcome: 'ok',
      result_count: 1,
      sensitive_returned: false,
    }]);
  });

  it('keeps the note text out of the audit log', async () => {
    const marker = await auditMarker(admin);
    const result = await logFollowup(counsellor, SEED_INQUIRY.erbilStale);
    expect(result.isError).toBeFalsy();

    // Every column of every audit row, so no path can have leaked it.
    const rows = await admin<{ row: string }[]>`select to_jsonb(audit_log)::text as row from audit_log`;
    expect(rows.length).toBeGreaterThan(0);
    for (const { row } of rows) {
      expect(row).not.toContain(NOTE);
      expect(row).not.toContain('Elias Steiner');
    }
    expect(await auditRowsSince(admin, marker)).toHaveLength(1);
  });
});

describe('log_followup refusals', () => {
  it('another campus’s inquiry: not found, audited as denied, nothing inserted', async () => {
    const before = await followupCount(SEED_INQUIRY.dubai);
    const marker = await auditMarker(admin);

    const result = await logFollowup(counsellor, SEED_INQUIRY.dubai);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(NOT_FOUND_MESSAGE);
    expect(await followupCount(SEED_INQUIRY.dubai)).toBe(before);
    expect(await auditRowsSince(admin, marker)).toEqual([
      {
        staff_id: SEED_STAFF.erbilCounsellor,
        tool_name: 'log_followup',
        arguments: { inquiry_id: SEED_INQUIRY.dubai, channel: 'phone' },
        outcome: 'denied',
        result_count: null,
        sensitive_returned: false,
      },
    ]);
  });

  it('a missing inquiry gets the same not-found message', async () => {
    const result = await logFollowup(counsellor, '00000000-0000-0000-0003-00000000ffff');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(NOT_FOUND_MESSAGE);
  });

  it('leadership is denied, audited, and nothing is inserted', async () => {
    const before = await followupCount(SEED_INQUIRY.erbil);
    const marker = await auditMarker(admin);

    const result = await logFollowup(leadership, SEED_INQUIRY.erbil);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Leadership accounts cannot log followups');
    expect(await followupCount(SEED_INQUIRY.erbil)).toBe(before);
    expect(await auditRowsSince(admin, marker)).toMatchObject([
      { staff_id: SEED_STAFF.leadership, tool_name: 'log_followup', outcome: 'denied' },
    ]);
  });

  it.each([
    { label: 'an empty note', note: '   ' },
    { label: 'a note over 1000 characters', note: 'x'.repeat(1001) },
  ])('rejects $label', async ({ note }) => {
    const result = await counsellor.client.callTool({
      name: 'log_followup',
      arguments: { inquiry_id: SEED_INQUIRY.erbilStale, channel: 'email', note },
    });
    expect(result.isError).toBe(true);
  });
});
