import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { testEnv } from './env.js';

const SEED_FILE = new URL('../supabase/seed.sql', import.meta.url);

/**
 * Puts the data back to exactly supabase/seed.sql. Faster than
 * `supabase db reset` and leaves the schema alone: migrations are assumed
 * applied. TRUNCATE doesn't fire audit_log's row-level delete guard.
 */
async function resetToSeed(): Promise<void> {
  const admin = postgres(testEnv.ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const seed = await readFile(SEED_FILE, 'utf8');
    await admin.begin(async (tx) => {
      const tables = await tx<{ tablename: string }[]>`
        select tablename from pg_tables where schemaname = 'public'
      `;
      await tx`truncate ${tx(tables.map((t) => t.tablename))} cascade`;
      // unsafe() because the seed is a multi-statement script; it is a
      // trusted file from this repo and takes no parameters.
      await tx.unsafe(seed);
    });
  } finally {
    await admin.end();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  await resetToSeed();
  return resetToSeed;
}
