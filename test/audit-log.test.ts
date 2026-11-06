import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createToolCallRunner } from '../src/tool-call.js';
import { auditMarker, auditRowsSince } from './audit.js';
import { connectAsAdmin, connectAsApp, SEED_INQUIRY, SEED_STAFF } from './db.js';
import { connectMcpClient, textOf, type McpSession } from './mcp.js';

const app = connectAsApp();
const admin = connectAsAdmin();
let counsellor: McpSession;

const StaleResultSchema = z.object({ inquiries: z.array(z.unknown()) });

beforeAll(async () => {
  counsellor = await connectMcpClient(app, SEED_STAFF.erbilCounsellor);
});

afterAll(async () => {
  await counsellor.close();
  await Promise.all([app.end(), admin.end()]);
});

describe('one audit row per tool call', () => {
  it('ok: records the validated arguments and the result count', async () => {
    const marker = await auditMarker(admin);
    const result = await counsellor.client.callTool({ name: 'find_stale_inquiries', arguments: {} });

    expect(result.isError).toBeFalsy();
    const returned = StaleResultSchema.parse(result.structuredContent).inquiries.length;
    expect(await auditRowsSince(admin, marker)).toEqual([
      {
        staff_id: SEED_STAFF.erbilCounsellor,
        tool_name: 'find_stale_inquiries',
        // The default was applied by schema validation, so it is recorded.
        arguments: { min_days_without_contact: 5 },
        outcome: 'ok',
        result_count: returned,
        sensitive_returned: false,
      },
    ]);
  });

  it('denied: another campus', async () => {
    const marker = await auditMarker(admin);
    const result = await counsellor.client.callTool({ name: 'find_stale_inquiries', arguments: { campus: 'dubai' } });

    expect(result.isError).toBe(true);
    expect(await auditRowsSince(admin, marker)).toMatchObject([
      { tool_name: 'find_stale_inquiries', arguments: { campus: 'dubai' }, outcome: 'denied', result_count: null },
    ]);
  });

  it('error: a failing query is recorded and returns no data', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const runToolCall = createToolCallRunner(app, SEED_STAFF.erbilCounsellor);
      const marker = await auditMarker(admin);

      // Division by zero aborts the transaction mid-call: the error must
      // still be audited, which only works because work runs in a savepoint.
      const result = await runToolCall('simulated_failure', { attempt: 1 }, async (tx) => {
        await tx`select 1 / 0`;
        return { outcome: 'ok', result: { content: [{ type: 'text', text: 'unreachable' }] }, resultCount: 1, sensitiveReturned: false };
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('simulated_failure failed and returned no data');
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('division by zero'));
      expect(await auditRowsSince(admin, marker)).toMatchObject([
        { tool_name: 'simulated_failure', arguments: { attempt: 1 }, outcome: 'error', result_count: null, sensitive_returned: false },
      ]);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('fail closed', () => {
  it('returns an error and no data when the audit row cannot be written', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await admin`revoke insert on audit_log from admissions_app`;
    try {
      const result = await counsellor.client.callTool({
        name: 'get_inquiry',
        arguments: { inquiry_id: SEED_INQUIRY.erbil },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(textOf(result)).toContain('could not be recorded in the audit log, so no data was returned');
      expect(textOf(result)).not.toContain('Rana');
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('get_inquiry audit failed'));
    } finally {
      await admin`grant insert on audit_log to admissions_app`;
      consoleError.mockRestore();
    }
  });
});
