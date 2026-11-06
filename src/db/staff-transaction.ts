import type { TransactionSql } from 'postgres';
import type { Sql } from './client.js';

export type StaffTransaction = TransactionSql;

/**
 * Runs `work` in a transaction whose row level security identity is the
 * acting staff member. Tools never get this directly: they get RunToolCall
 * (src/tool-call.ts), which builds on it and also writes the audit row.
 */
export type RunAsStaff = <T>(work: (tx: StaffTransaction) => Promise<T>) => Promise<T>;

/** The database policies read this setting through current_staff(). */
const STAFF_ID_SETTING = 'app.staff_id';

export function createRunAsStaff(sql: Sql, staffId: string): RunAsStaff {
  return async (work) => {
    // Boxed because postgres.js types begin()'s result as
    // UnwrapPromiseArray<T>, which TypeScript can't reduce for a generic T.
    const box = await sql.begin(async (tx) => {
      // is_local = true scopes the identity to this transaction, so it can't
      // carry over into another call that reuses the pooled connection.
      await tx`select set_config(${STAFF_ID_SETTING}, ${staffId}, true)`;
      return { value: await work(tx) };
    });
    return box.value;
  };
}
