/**
 * Dev/test-only MCP server over Silk's command registry (spec §2, ADR 0003).
 * Not part of the module bundle. Tools are derived live from the registry, so every
 * command a feature registers shows up without changes here.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export interface CommandInfo {
  name: string;
  title: string;
  available: boolean;
}

/** How the server reaches a running Silk. `pageBridge` drives a Foundry page; tests fake it. */
export interface SilkBridge {
  listCommands(): Promise<CommandInfo[]>;
  run(name: string, args: object): Promise<unknown>;
}

/** MCP tool names may not contain dots; command segments are camelCase, so `_` is unambiguous. */
const toToolName = (command: string) => command.replaceAll('.', '_');

export function createSilkMcpServer(bridge: SilkBridge): Server {
  const server = new Server(
    { name: 'silk-dev', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await bridge.listCommands()).map((c) => ({
      name: toToolName(c.name),
      description:
        `Silk command \`${c.name}\` (${c.title}). Args per spec §15.` +
        (c.available ? '' : ' Currently not available (e.g. needs GM).'),
      inputSchema: { type: 'object' as const, additionalProperties: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const text = (text: string, isError = false) => ({
      content: [{ type: 'text' as const, text }],
      isError,
    });
    const commands = await bridge.listCommands();
    const command = commands.find((c) => toToolName(c.name) === params.name);
    if (!command) return text(`Silk: no command behind tool "${params.name}"`, true);
    try {
      const result = await bridge.run(command.name, params.arguments ?? {});
      return text(JSON.stringify(result ?? null));
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true);
    }
  });

  return server;
}
