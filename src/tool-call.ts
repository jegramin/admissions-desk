import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Sql } from './db/client.js';
import { createRunAsStaff, type StaffTransaction } from './db/staff-transaction.js';

/**
 * What a tool's work function reports back. It is deliberately not a
 * CallToolResult: the only way to turn it into one is RunToolCall, which
 * writes the audit row. 'error' is never returned by a tool; it is recorded
 * when the work function throws.
 */
export type ToolCallResult =
  | { outcome: 'ok'; result: CallToolResult; resultCount: number; sensitiveReturned: boolean }
  | { outcome: 'denied'; result: CallToolResult };

type RecordedCall = ToolCallResult | { outcome: 'error'; result: CallToolResult };

/** Validated tool arguments, as stored in audit_log.arguments. */
export type AuditArguments = Record<string, string | number | boolean | undefined>;

/**
 * Runs one tool call: sets the RLS identity, runs `work`, and writes exactly
 * one audit_log row, all in one transaction. The result is released only
 * after that transaction commits, so if the audit row can't be written the
 * caller gets an error and no data.
 */
export type RunToolCall = (
  toolName: string,
  args: AuditArguments,
  work: (tx: StaffTransaction) => Promise<ToolCallResult>
) => Promise<CallToolResult>;

export function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function failedMessage(toolName: string): string {
  return `${toolName} failed and returned no data. Try again; if it keeps failing, ask an administrator to check the Admissions Desk server logs.`;
}

function unrecordedMessage(toolName: string): string {
  return `${toolName} could not be recorded in the audit log, so no data was returned. Ask an administrator to check the Admissions Desk server logs.`;
}

/** Message and SQLSTATE only: driver errors can carry row values in `detail`, which may be personal data. */
function logFailure(toolName: string, stage: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error ? ` [${String(error.code)}]` : '';
  console.error(`Admissions Desk: ${toolName} ${stage} failed${code}: ${message}`);
}

function auditColumns(call: RecordedCall): { resultCount: number | null; sensitiveReturned: boolean } {
  switch (call.outcome) {
    case 'ok':
      return { resultCount: call.resultCount, sensitiveReturned: call.sensitiveReturned };
    case 'denied':
    case 'error':
      return { resultCount: null, sensitiveReturned: false };
    default: {
      const unreachable: never = call;
      return unreachable;
    }
  }
}

export function createToolCallRunner(sql: Sql, staffId: string): RunToolCall {
  const runAsStaff = createRunAsStaff(sql, staffId);

  return async (toolName, args, work) => {
    try {
      return await runAsStaff(async (tx) => {
        // A savepoint, so a failed query inside `work` rolls back only its
        // own statements and the transaction can still record the error.
        let call: RecordedCall;
        try {
          call = await tx.savepoint((sp) => work(sp));
        } catch (error) {
          logFailure(toolName, 'call', error);
          call = { outcome: 'error', result: toolError(failedMessage(toolName)) };
        }

        const { resultCount, sensitiveReturned } = auditColumns(call);
        await tx`
          insert into audit_log (staff_id, tool_name, arguments, outcome, result_count, sensitive_returned)
          values (${staffId}, ${toolName}, ${tx.json(args)}, ${call.outcome}, ${resultCount}, ${sensitiveReturned})
        `;
        return call.result;
      });
    } catch (error) {
      // The identity or audit write failed, so nothing from `work` may leave.
      logFailure(toolName, 'audit', error);
      return toolError(unrecordedMessage(toolName));
    }
  };
}
