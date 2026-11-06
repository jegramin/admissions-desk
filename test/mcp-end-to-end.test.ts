import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAsApp, SEED_INQUIRY, SEED_STAFF } from './db.js';
import { connectMcpClient, textOf, type McpSession } from './mcp.js';

const app = connectAsApp();
let session: McpSession;

beforeAll(async () => {
  session = await connectMcpClient(app, SEED_STAFF.erbilCounsellor);
});

afterAll(async () => {
  await session.close();
  await app.end();
});

describe('MCP end to end (in-memory transport, admissions_app role)', () => {
  it('lists the tools', async () => {
    const { tools } = await session.client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(['find_stale_inquiries', 'get_inquiry', 'log_followup', 'pipeline_summary']);
    const getInquiry = tools.find((t) => t.name === 'get_inquiry');
    expect(getInquiry?.inputSchema.properties).toHaveProperty('include_sensitive');
  });

  it('marks the three read tools read-only and log_followup as a non-idempotent, non-destructive write', async () => {
    const { tools } = await session.client.listTools();
    const annotations = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));

    for (const name of ['find_stale_inquiries', 'get_inquiry', 'pipeline_summary']) {
      expect(annotations[name], name).toMatchObject({ readOnlyHint: true });
    }
    expect(annotations['log_followup']).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });

  it('calls get_inquiry and gets the record back', async () => {
    const result = await session.client.callTool({ name: 'get_inquiry', arguments: { inquiry_id: SEED_INQUIRY.erbil } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      inquiryId: SEED_INQUIRY.erbil,
      campusId: 'erbil',
      applicant: { firstName: 'Rana', lastName: 'Jabbar' },
      guardian: { fullName: 'Mariam Jabbar' },
    });
    expect(textOf(result)).toContain('Rana Jabbar');
  });
});
