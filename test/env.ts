import { z } from 'zod';

// Defaults point at the local Supabase stack (supabase/config.toml, db port
// 55322). The admissions_app password is the local-only one set in the
// app-role migration.
const TestEnvSchema = z.object({
  DATABASE_URL: z.url().default('postgresql://admissions_app:admissions_app_local_only@127.0.0.1:55322/postgres'),
  ADMIN_DATABASE_URL: z.url().default('postgresql://postgres:postgres@127.0.0.1:55322/postgres'),
});

export const testEnv = TestEnvSchema.parse(process.env);

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// The suite truncates every table before and after running. Refuse anything
// but a local database so a stray ADMIN_DATABASE_URL can't wipe real data.
const adminHost = new URL(testEnv.ADMIN_DATABASE_URL).hostname;
if (!LOCAL_HOSTS.has(adminHost)) {
  throw new Error(`Refusing to run tests: ADMIN_DATABASE_URL host "${adminHost}" is not local.`);
}
