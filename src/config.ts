import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  // z.guid(), not z.uuid(): our seed data uses readable sequential ids
  // (e.g. 00000000-0000-0000-0000-000000000001), which aren't RFC 4122
  // version/variant compliant but are perfectly valid Postgres uuid values.
  ADMISSIONS_STAFF_ID: z.guid(),
});

export type Config = z.infer<typeof EnvSchema>;

/** Reads and validates server config from env vars. Exits the process on failure — stdout is reserved for MCP, so every message goes to stderr. */
export function loadConfig(): Config {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Admissions Desk: invalid configuration.');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
