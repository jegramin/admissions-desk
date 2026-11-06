import { afterAll, describe, expect, it } from 'vitest';
import { createRunAsStaff } from '../src/db/staff-transaction.js';
import { connectAsAdmin, connectAsApp, PERMISSION_DENIED, SEED_INQUIRY, SEED_STAFF } from './db.js';

// Every assertion here runs as admissions_app, the role the MCP server
// connects as, and queries tables directly instead of through a tool, so it
// proves the database refuses on its own, independent of the server's SQL.

const app = connectAsApp();
const admin = connectAsAdmin();

afterAll(async () => {
  await Promise.all([app.end(), admin.end()]);
});

const PROTECTED_READABLE = ['guardians', 'applicants', 'applicant_private', 'inquiries', 'followups', 'inquiry_activity'];

async function countAs(staffId: string, relation: string): Promise<number> {
  return createRunAsStaff(app, staffId)(async (tx) => {
    const [row] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(relation)}`;
    return row?.n ?? 0;
  });
}

/** Ids of applicants with an inquiry at `campusId`, read as admin. */
async function applicantIdsAt(campusId: string): Promise<string[]> {
  const rows = await admin<{ applicant_id: string }[]>`
    select distinct applicant_id from inquiries where campus_id = ${campusId} order by applicant_id
  `;
  return rows.map((r) => r.applicant_id);
}

describe('Erbil counsellor', () => {
  const runAsCounsellor = createRunAsStaff(app, SEED_STAFF.erbilCounsellor);

  it('sees Erbil inquiries but no Dubai ones', async () => {
    const byCampus = await runAsCounsellor(
      (tx) => tx<{ campus_id: string; n: number }[]>`
        select campus_id, count(*)::int as n from inquiries group by campus_id
      `
    );
    expect(byCampus.map((r) => r.campus_id)).toEqual(['erbil']);

    const dubai = await runAsCounsellor((tx) => tx`select id from inquiries where campus_id = 'dubai'`);
    expect(dubai).toHaveLength(0);
  });

  it('gets no applicant_private rows, even for its own campus', async () => {
    expect(await countAs(SEED_STAFF.erbilCounsellor, 'applicant_private')).toBe(0);
  });
});

describe('Erbil campus_head', () => {
  it('reads applicant_private for exactly the Erbil applicants', async () => {
    const expected = await applicantIdsAt('erbil');
    expect(expected.length).toBeGreaterThan(0);

    const visible = await createRunAsStaff(app, SEED_STAFF.erbilCampusHead)(
      (tx) => tx<{ applicant_id: string }[]>`select applicant_id from applicant_private order by applicant_id`
    );
    expect(visible.map((r) => r.applicant_id)).toEqual(expected);
  });
});

describe('leadership', () => {
  it.each(['inquiries', 'applicant_private'])('gets no individual rows from %s', async (relation) => {
    expect(await countAs(SEED_STAFF.leadership, relation)).toBe(0);
  });
});

describe('without a valid app.staff_id', () => {
  // Missing entirely, plus the two ways a set value can name nobody.
  const identities = [
    { label: 'unset', setting: null },
    { label: 'unknown staff id', setting: '00000000-0000-0000-0000-00000000ffff' },
    { label: 'malformed staff id', setting: 'not-a-uuid' },
  ] as const;

  describe.each(identities)('$label', ({ setting }) => {
    it.each(PROTECTED_READABLE)('%s returns 0 rows', async (relation) => {
      const n = await app.begin(async (tx) => {
        if (setting !== null) {
          await tx`select set_config('app.staff_id', ${setting}, true)`;
        }
        const [row] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(relation)}`;
        return row?.n ?? 0;
      });
      expect(n).toBe(0);
    });

    it('audit_log cannot be read at all', async () => {
      await expect(app`select count(*) from audit_log`).rejects.toMatchObject({ code: PERMISSION_DENIED });
    });
  });
});

describe('inquiry_activity view', () => {
  it('returns only the current staff member’s campus', async () => {
    const [expected] = await admin<{ n: number }[]>`
      select count(*)::int as n from inquiries where campus_id = 'erbil'
    `;

    const rows = await createRunAsStaff(app, SEED_STAFF.erbilCounsellor)(
      (tx) => tx<{ campus_id: string }[]>`select campus_id from inquiry_activity`
    );
    expect(rows.length).toBe(expected?.n);
    expect(new Set(rows.map((r) => r.campus_id))).toEqual(new Set(['erbil']));
  });

  it('returns nothing to leadership', async () => {
    expect(await countAs(SEED_STAFF.leadership, 'inquiry_activity')).toBe(0);
  });
});

describe('writes', () => {
  // Base tables only: inquiry_activity aggregates, so Postgres rejects any
  // write to it as "not updatable" before privileges are even checked.
  it('UPDATE and DELETE are denied on every table', async () => {
    const relations = await admin<{ relation: string; column: string }[]>`
      select c.table_name as relation, min(c.column_name) as column
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      group by c.table_name
      order by c.table_name
    `;
    expect(relations.length).toBeGreaterThan(0);

    for (const { relation, column } of relations) {
      await expect(
        app`update ${app(relation)} set ${app(column)} = ${app(column)}`,
        `UPDATE ${relation}`
      ).rejects.toMatchObject({ code: PERMISSION_DENIED });
      await expect(app`delete from ${app(relation)}`, `DELETE ${relation}`).rejects.toMatchObject({
        code: PERMISSION_DENIED,
      });
    }
  });

  it('INSERT is denied on every table except followups and audit_log', async () => {
    const tables = await admin<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
        and table_name not in ('followups', 'audit_log')
      order by table_name
    `;
    expect(tables.length).toBeGreaterThan(0);

    // The privilege check runs before any row is built, so DEFAULT VALUES
    // fails with permission denied rather than a not-null violation.
    for (const { table_name } of tables) {
      await expect(app`insert into ${app(table_name)} default values`, `INSERT ${table_name}`).rejects.toMatchObject({
        code: PERMISSION_DENIED,
      });
    }
  });
});

describe('followups INSERT', () => {
  const runAsCounsellor = createRunAsStaff(app, SEED_STAFF.erbilCounsellor);

  function insertFollowup(inquiryId: string, staffId: string) {
    return runAsCounsellor(
      (tx) => tx`
        insert into followups (inquiry_id, staff_id, channel, note)
        values (${inquiryId}, ${staffId}, 'email', 'RLS test followup')
        returning id
      `
    );
  }

  /** An enrolled inquiry, so the extra followup can't change any staleness result. */
  async function erbilEnrolledInquiry(): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      select id from inquiries where campus_id = 'erbil' and stage = 'enrolled' order by id limit 1
    `;
    if (!row) {
      throw new Error('Seed has no enrolled Erbil inquiry');
    }
    return row.id;
  }

  it('is allowed on an own-campus inquiry as yourself', async () => {
    const inserted = await insertFollowup(await erbilEnrolledInquiry(), SEED_STAFF.erbilCounsellor);
    expect(inserted).toHaveLength(1);
  });

  it('is denied on another campus’s inquiry', async () => {
    await expect(insertFollowup(SEED_INQUIRY.dubai, SEED_STAFF.erbilCounsellor)).rejects.toMatchObject({
      code: PERMISSION_DENIED,
    });
  });

  it('is denied with someone else’s staff_id', async () => {
    await expect(insertFollowup(await erbilEnrolledInquiry(), SEED_STAFF.erbilCampusHead)).rejects.toMatchObject({
      code: PERMISSION_DENIED,
    });
  });
});

describe('Supabase API roles', () => {
  it.each(['anon', 'authenticated'])('%s cannot read any of our tables or views', async (apiRole) => {
    const relations = await admin<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public' order by table_name
    `;
    expect(relations.length).toBeGreaterThan(0);

    for (const { table_name } of relations) {
      const read = admin.begin(async (tx) => {
        await tx`select set_config('role', ${apiRole}, true)`;
        return tx`select 1 from ${tx(table_name)} limit 1`;
      });
      await expect(read, `${apiRole} SELECT ${table_name}`).rejects.toMatchObject({ code: PERMISSION_DENIED });
    }
  });
});
