import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { createDbClient } from './db/client.js';
import { loadActingStaff } from './staff-context.js';
import { createServer } from './server.js';

const config = loadConfig();
const sql = createDbClient(config);
const staff = await loadActingStaff(sql, config.ADMISSIONS_STAFF_ID);

console.error(
  `Admissions Desk: running as ${staff.fullName} (${staff.role}${staff.campusId ? `, ${staff.campusId}` : ''}).`
);

serveStdio(() => createServer(sql, staff));
