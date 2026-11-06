import { McpServer } from '@modelcontextprotocol/server';
import type { RunAsStaff } from './db/staff-transaction.js';
import type { StaffContext } from './staff-context.js';
import { registerFindStaleInquiriesTool } from './tools/find-stale-inquiries.js';
import { registerGetInquiryTool } from './tools/get-inquiry.js';

/** Tools get `runAsStaff`, never the raw connection, so every query runs with the RLS identity set. */
export function createServer(runAsStaff: RunAsStaff, staff: StaffContext): McpServer {
  const server = new McpServer({ name: 'admissions-desk', version: '0.1.0' });
  registerFindStaleInquiriesTool(server, runAsStaff, staff);
  registerGetInquiryTool(server, runAsStaff, staff);
  return server;
}
