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

    expect(tools.map((t) => t.name).sort()).toEqual(['find_stale_inquiries', 'get_inquiry']);
    const getInquiry = tools.find((t) => t.name === 'get_inquiry');
    expect(getInquiry?.inputSchema.properties).toHaveProperty('include_sensitive');
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
