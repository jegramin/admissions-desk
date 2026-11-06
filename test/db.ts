import postgres from 'postgres';
import { testEnv } from './env.js';

/** Connects as the restricted role the MCP server uses. */
export function connectAsApp(): postgres.Sql {
  return postgres(testEnv.DATABASE_URL, { max: 2 });
}

/** Connects as postgres (BYPASSRLS): for fixtures and expected values only. */
export function connectAsAdmin(): postgres.Sql {
  return postgres(testEnv.ADMIN_DATABASE_URL, { max: 2, onnotice: () => {} });
}

/** Staff ids from supabase/seed.sql. */
export const SEED_STAFF = {
  erbilCounsellor: '00000000-0000-0000-0000-000000000001',
  erbilCampusHead: '00000000-0000-0000-0000-000000000002',
  leadership: '00000000-0000-0000-0000-000000000007',
} as const;

export const PERMISSION_DENIED = '42501';
