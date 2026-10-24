/**
 * Dev/test-only MCP server (stdio) over Silk's command API. Not shipped.
 *
 *   node tools/mcp/main.ts --url http://localhost:30001 [--cdp http://localhost:9222]
 *     [--user Gamemaster] [--password ...] [--executable /usr/bin/chromium] [--headed]
 *
 * Connects to Foundry lazily on the first tool call and reconnects if the page closes.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Page } from 'playwright-core';
import { parseArgs } from 'node:util';
import { connectFoundryPage } from './connect.ts';
import { pageBridge } from './page-bridge.ts';
import { createSilkMcpServer, type SilkBridge } from './server.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.SILK_FOUNDRY_URL ?? 'http://localhost:30000' },
    cdp: { type: 'string' },
    user: { type: 'string' },
    password: { type: 'string', default: process.env.SILK_FOUNDRY_PASSWORD },
    executable: { type: 'string' },
    headed: { type: 'boolean', default: false },
  },
});

let page: Promise<Page> | undefined;
const getPage = () => {
  page ??= connectFoundryPage({
    url: values.url,
    cdp: values.cdp,
    user: values.user,
    password: values.password,
    executablePath: values.executable,
    headless: !values.headed,
  }).then(
    (p) => {
      p.on('close', () => (page = undefined));
      return p;
    },
    (error: unknown) => {
      page = undefined;
      throw error;
    },
  );
  return page;
};

const bridge: SilkBridge = {
  listCommands: async () => pageBridge(await getPage()).listCommands(),
  run: async (name, args) => pageBridge(await getPage()).run(name, args),
};

await createSilkMcpServer(bridge).connect(new StdioServerTransport());
