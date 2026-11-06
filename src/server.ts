import { McpServer } from '@modelcontextprotocol/server';
import type { Sql } from './db/client.js';
import type { StaffContext } from './staff-context.js';
import { registerFindStaleInquiriesTool } from './tools/find-stale-inquiries.js';
import { registerGetInquiryTool } from './tools/get-inquiry.js';

export function createServer(sql: Sql, staff: StaffContext): McpServer {
  const server = new McpServer({ name: 'admissions-desk', version: '0.1.0' });
  registerFindStaleInquiriesTool(server, sql, staff);
  registerGetInquiryTool(server, sql, staff);
  return server;
}
