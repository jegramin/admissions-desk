import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GetPromptResult } from '@modelcontextprotocol/client';
import { connectAsAdmin, connectAsApp, SEED_STAFF } from './db.js';
import { connectMcpClient, type McpSession } from './mcp.js';

const app = connectAsApp();
const admin = connectAsAdmin();
let leadership: McpSession;

const PROMPT_NAME = 'weekly_leadership_brief';

beforeAll(async () => {
  leadership = await connectMcpClient(app, SEED_STAFF.leadership);
});

afterAll(async () => {
  await leadership.close();
  await Promise.all([app.end(), admin.end()]);
});

/** Every id and personal name in the seed: none may appear in the prompt. */
async function seedIdentifiers(): Promise<string[]> {
  const rows = await admin<{ value: string }[]>`
    select id::text as value from inquiries
    union select id::text from applicants
    union select id::text from guardians
    union select id::text from staff
    union select first_name from applicants
    union select last_name from applicants
    union select full_name from guardians
    union select full_name from staff
  `;
  return rows.map((r) => r.value);
}

function promptText(result: GetPromptResult): string {
  return result.messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');
}

describe('weekly_leadership_brief prompt', () => {
  it('lists its one optional argument, campus', async () => {
    const { prompts } = await leadership.client.listPrompts();
    const brief = prompts.find((p) => p.name === PROMPT_NAME);

    // Vitest types asymmetric matchers as `any`; the matcher is the assertion.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(brief?.arguments).toEqual([{ name: 'campus', description: expect.any(String), required: false }]);
  });

  it('tells the model to call pipeline_summary for every campus, and carries no seed data', async () => {
    const result = await leadership.client.getPrompt({ name: PROMPT_NAME });
    const text = promptText(result);

    expect(result.messages.length).toBeGreaterThan(0);
    expect(text).toContain('pipeline_summary');
    expect(text).toContain('every campus combined');
    for (const identifier of await seedIdentifiers()) {
      expect(text, identifier).not.toContain(identifier);
    }
  });

  it('scopes the call to one campus when given', async () => {
    const text = promptText(await leadership.client.getPrompt({ name: PROMPT_NAME, arguments: { campus: 'vienna' } }));

    expect(text).toContain('Call pipeline_summary with campus "vienna"');
  });
});
