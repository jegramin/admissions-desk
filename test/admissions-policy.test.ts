import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditMarker, auditRowsSince } from './audit.js';
import { connectAsAdmin, connectAsApp, SEED_STAFF } from './db.js';
import { connectMcpClient, type McpSession } from './mcp.js';

const app = connectAsApp();
const admin = connectAsAdmin();
let counsellor: McpSession;
let leadership: McpSession;

const POLICY_URIS = ['admissions://policy/dubai', 'admissions://policy/erbil', 'admissions://policy/vienna'];
// ResourceNotFoundError in SDK 2.4.0 is sent as JSON-RPC InvalidParams.
const INVALID_PARAMS = -32602;

beforeAll(async () => {
  counsellor = await connectMcpClient(app, SEED_STAFF.erbilCounsellor);
  leadership = await connectMcpClient(app, SEED_STAFF.leadership);
});

afterAll(async () => {
  await Promise.all([counsellor.close(), leadership.close()]);
  await Promise.all([app.end(), admin.end()]);
});

function policyFile(campus: string): Promise<string> {
  return readFile(new URL(`../content/policy/${campus}.md`, import.meta.url), 'utf8');
}

describe('admissions policy resource', () => {
  it('lists one policy per campus', async () => {
    const { resources } = await counsellor.client.listResources();

    expect(resources.map((r) => r.uri).sort()).toEqual(POLICY_URIS);
    for (const resource of resources) {
      expect(resource).toMatchObject({ mimeType: 'text/markdown' });
    }
  });

  it('returns the campus markdown, marked as fictional', async () => {
    const result = await counsellor.client.readResource({ uri: 'admissions://policy/vienna' });

    const expected = await policyFile('vienna');
    expect(result.contents).toEqual([{ uri: 'admissions://policy/vienna', mimeType: 'text/markdown', text: expected }]);
    expect(expected).toContain('Fictional demo content');
    expect(expected).toContain('3 working days');
  });

  it('is readable by leadership too, and writes no audit row', async () => {
    const marker = await auditMarker(admin);
    const result = await leadership.client.readResource({ uri: 'admissions://policy/dubai' });

    expect(result.contents).toEqual([
      { uri: 'admissions://policy/dubai', mimeType: 'text/markdown', text: await policyFile('dubai') },
    ]);
    expect(await auditRowsSince(admin, marker)).toEqual([]);
  });

  it('rejects an unknown campus with an error naming the known ones', async () => {
    const read = counsellor.client.readResource({ uri: 'admissions://policy/atlantis' });

    await expect(read).rejects.toMatchObject({
      // Vitest types asymmetric matchers as `any`; the matcher is the assertion.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      message: expect.stringContaining('No admissions policy for campus "atlantis". Known campuses: erbil, dubai, vienna.'),
    });
    await expect(read).rejects.toMatchObject({ code: INVALID_PARAMS });
  });
});
