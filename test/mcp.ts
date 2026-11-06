import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type postgres from 'postgres';
import { createServer } from '../src/server.js';
import { loadActingStaff } from '../src/staff-context.js';
import { createToolCallRunner } from '../src/tool-call.js';

export interface McpSession {
  client: Client;
  close: () => Promise<void>;
}

/**
 * The real server wiring from src/index.ts, as `staffId`, reached through a
 * real MCP client over the SDK's in-memory transport instead of stdio.
 */
export async function connectMcpClient(sql: postgres.Sql, staffId: string): Promise<McpSession> {
  const staff = await loadActingStaff(sql, staffId);
  const server = createServer(createToolCallRunner(sql, staff.id), staff);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'admissions-desk-tests', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: CallToolResult): string {
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}
