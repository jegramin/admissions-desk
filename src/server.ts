import { McpServer } from '@modelcontextprotocol/server';
import { registerWeeklyLeadershipBriefPrompt } from './prompts/weekly-leadership-brief.js';
import { registerAdmissionsPolicyResource } from './resources/admissions-policy.js';
import type { StaffContext } from './staff-context.js';
import type { RunToolCall } from './tool-call.js';
import { registerFindStaleInquiriesTool } from './tools/find-stale-inquiries.js';
import { registerGetInquiryTool } from './tools/get-inquiry.js';
import { registerLogFollowupTool } from './tools/log-followup.js';
import { registerPipelineSummaryTool } from './tools/pipeline-summary.js';

/**
 * Tools get `runToolCall`, never the raw connection, so every call runs with
 * the RLS identity set and writes exactly one audit row. The policy resource
 * and the brief prompt touch no database, so they get neither.
 */
export function createServer(runToolCall: RunToolCall, staff: StaffContext): McpServer {
  const server = new McpServer({ name: 'admissions-desk', version: '0.1.0' });
  registerFindStaleInquiriesTool(server, runToolCall, staff);
  registerGetInquiryTool(server, runToolCall, staff);
  registerPipelineSummaryTool(server, runToolCall, staff);
  registerLogFollowupTool(server, runToolCall, staff);
  registerAdmissionsPolicyResource(server);
  registerWeeklyLeadershipBriefPrompt(server);
  return server;
}
