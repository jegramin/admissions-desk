import postgres from 'postgres';
import type { Config } from '../config.js';

export type Sql = ReturnType<typeof postgres>;

/** postgres.js defaults `onnotice` to `console.log`, which would corrupt the MCP stdio stream — route it to stderr instead. */
export function createDbClient(config: Config): Sql {
  return postgres(config.DATABASE_URL, {
    onnotice: (notice) => {
      console.error(notice);
    },
  });
}
