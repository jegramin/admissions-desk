import type { Sql } from './db/client.js';
import type { Database } from './db/types.js';

export type StaffRole = Database['public']['Enums']['staff_role'];

/** The identity every tool call runs as, loaded once at startup. */
export interface StaffContext {
  id: string;
  fullName: string;
  role: StaffRole;
  /** Null only for leadership — enforced by the staff_campus_matches_role CHECK constraint. */
  campusId: string | null;
}

type StaffRow = Pick<Database['public']['Tables']['staff']['Row'], 'id' | 'full_name' | 'role' | 'campus_id'>;

/** Loads the acting staff member. Exits the process if ADMISSIONS_STAFF_ID doesn't match anyone. */
export async function loadActingStaff(sql: Sql, staffId: string): Promise<StaffContext> {
  const rows = await sql<StaffRow[]>`
    select id, full_name, role, campus_id
    from staff
    where id = ${staffId}
  `;

  const staff = rows[0];
  if (!staff) {
    console.error(
      `Admissions Desk: no staff member found with id ${staffId}. Refusing to start — check ADMISSIONS_STAFF_ID.`
    );
    process.exit(1);
  }

  return {
    id: staff.id,
    fullName: staff.full_name,
    role: staff.role,
    campusId: staff.campus_id,
  };
}
