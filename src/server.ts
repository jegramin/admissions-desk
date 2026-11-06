import { McpServer } from '@modelcontextprotocol/server';
import type { StaffContext } from './staff-context.js';
import type { RunToolCall } from './tool-call.js';
import { registerFindStaleInquiriesTool } from './tools/find-stale-inquiries.js';
import { registerGetInquiryTool } from './tools/get-inquiry.js';

/**
 * Tools get `runToolCall`, never the raw connection, so every call runs with
 * the RLS identity set and writes exactly one audit row.
 */
export function createServer(runToolCall: RunToolCall, staff: StaffContext): McpServer {
  const server = new McpServer({ name: 'admissions-desk', version: '0.1.0' });
  registerFindStaleInquiriesTool(server, runToolCall, staff);
  registerGetInquiryTool(server, runToolCall, staff);
  return server;
}
