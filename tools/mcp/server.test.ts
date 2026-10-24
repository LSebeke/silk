import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createSilkMcpServer, type SilkBridge } from './server';

function fakeBridge(overrides: Partial<SilkBridge> = {}): SilkBridge {
  return {
    listCommands: async () => [
      { name: 'canvas.open', title: 'SILK.Command.canvas.open', available: true },
      { name: 'element.create', title: 'Create element', available: false },
    ],
    run: async (name, args) => ({ ran: name, args }),
    ...overrides,
  };
}

async function connect(bridge: SilkBridge) {
  const server = createSilkMcpServer(bridge);
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe('Silk dev MCP server', () => {
  it('lists one tool per registry command, dots mapped to underscores', async () => {
    const client = await connect(fakeBridge());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['canvas_open', 'element_create']);
    expect(tools[0]?.description).toContain('canvas.open');
    expect(tools[1]?.description).toContain('not available');
    expect(tools[0]?.inputSchema.type).toBe('object');
  });

  it('calling a tool runs the command with its args and returns the result as JSON', async () => {
    const client = await connect(fakeBridge());
    const result = await client.callTool({
      name: 'element_create',
      arguments: { class: 'person', name: 'Alrik' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ ran: 'element.create', args: { class: 'person', name: 'Alrik' } }),
      },
    ]);
  });

  it('a failing command comes back as a tool error carrying its message', async () => {
    const client = await connect(
      fakeBridge({
        run: async () => {
          throw new Error('Silk: command "element.create" is not available right now');
        },
      }),
    );
    const result = await client.callTool({ name: 'element_create', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Silk: command "element.create" is not available right now' },
    ]);
  });

  it('an unknown tool is a tool error, not a call into Foundry', async () => {
    let ran = false;
    const client = await connect(
      fakeBridge({
        run: async () => {
          ran = true;
        },
      }),
    );
    const result = await client.callTool({ name: 'nope_nope', arguments: {} });
    expect(result.isError).toBe(true);
    expect(ran).toBe(false);
  });
});
