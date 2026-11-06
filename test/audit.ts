import type postgres from 'postgres';
import type { Database } from '../src/db/types.js';

type AuditRow = Pick<
  Database['public']['Tables']['audit_log']['Row'],
  'staff_id' | 'tool_name' | 'arguments' | 'outcome' | 'result_count' | 'sensitive_returned'
>;

/**
 * A point in time to read audit rows after. Kept as text so the comparison
 * keeps Postgres's microseconds; a JS Date would round to milliseconds and
 * could pull in the previous test's row.
 */
export async function auditMarker(admin: postgres.Sql): Promise<string> {
  const [row] = await admin<{ at: string }[]>`select clock_timestamp()::text as at`;
  if (!row) {
    throw new Error('clock_timestamp() returned no row');
  }
  return row.at;
}

export async function auditRowsSince(admin: postgres.Sql, marker: string): Promise<AuditRow[]> {
  return admin<AuditRow[]>`
    select staff_id, tool_name, arguments, outcome, result_count, sensitive_returned
    from audit_log
    where created_at > ${marker}::timestamptz
    order by created_at
  `;
}
