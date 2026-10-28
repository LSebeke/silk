/**
 * Headless Foundry for e2e (spec §14). Each run gets its own throwaway data dir that
 * links the installed dsa5 system and this checkout's `dist/` as module `silk`, so a
 * run can never see or touch `silk-dev` and parallel runs from other worktrees don't clash.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const FOUNDRY_MAIN =
  process.env.FOUNDRY_MAIN ?? '/mnt/Data/Software/FoundryVTT/resources/app/main.js';
export const FOUNDRY_USER_DATA =
  process.env.FOUNDRY_USER_DATA ?? join(homedir(), '.local/share/FoundryVTT');

export function testWorldId(run: string): string {
  if (!/^[a-z0-9-]+$/.test(run)) throw new Error(`Invalid test run id: "${run}"`);
  return `silk-test-${run}`;
}

/** Throwaway data dir: license copied, dsa5 + built module symlinked, no worlds. */
export function prepareDataPath(opts: { source: string; dist: string; parent?: string }): string {
  const dataPath = mkdtempSync(join(opts.parent ?? tmpdir(), 'silk-foundry-'));
  mkdirSync(join(dataPath, 'Config'));
  copyFileSync(join(opts.source, 'Config/license.json'), join(dataPath, 'Config/license.json'));
  for (const dir of ['systems', 'modules', 'worlds']) {
    mkdirSync(join(dataPath, 'Data', dir), { recursive: true });
  }
  symlinkSync(join(opts.source, 'Data/systems/dsa5'), join(dataPath, 'Data/systems/dsa5'));
  symlinkSync(opts.dist, join(dataPath, 'Data/modules/silk'));
  return dataPath;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

export interface Foundry {
  url: string;
  dataPath: string;
  process: ChildProcess;
  /** POST JSON as the setup admin (same-origin, session cookie kept). */
  post(path: string, body: unknown): Promise<Record<string, unknown>>;
  stop(): Promise<void>;
}

export async function startFoundry(opts: { dataPath: string; port: number }): Promise<Foundry> {
  const url = `http://localhost:${opts.port}`;
  const child = spawn(
    process.execPath,
    [FOUNDRY_MAIN, '--headless', '--noupnp', `--dataPath=${opts.dataPath}`, `--port=${opts.port}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString()));

  let cookie = '';
  const request = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(url + path, {
      ...init,
      redirect: 'manual',
      // Foundry rejects cross-site POSTs: Origin must match the server.
      headers: { origin: url, cookie, ...init.headers },
    });
    const session = res.headers.get('set-cookie')?.match(/session=[^;]+/)?.[0];
    if (session) cookie = session;
    return res;
  };

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Foundry exited early:\n${log}`);
    try {
      await request('/setup');
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`Foundry did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  return {
    url,
    dataPath: opts.dataPath,
    process: child,
    async post(path, body) {
      const res = await request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok || json.error) throw new Error(`POST ${path} failed: ${JSON.stringify(json)}`);
      return json;
    },
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once('exit', r));
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    },
  };
}

/** Creates `silk-test-<run>` (dsa5) and launches it. */
export async function createAndLaunchWorld(foundry: Foundry, run: string): Promise<string> {
  const id = testWorldId(run);
  await foundry.post('/create', { action: 'createWorld', id, title: id, system: 'dsa5' });
  await foundry.post('/setup', { action: 'launchWorld', world: id });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = (await (await fetch(`${foundry.url}/api/status`)).json()) as { world?: string };
    if (status.world === id) return id;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`World ${id} did not launch`);
}

/** Deletes a `silk-test-*` world dir; refuses any other id. */
export function deleteWorld(foundry: Foundry, id: string): void {
  if (!/^silk-test-[a-z0-9-]+$/.test(id)) throw new Error(`Refusing to delete world "${id}"`);
  rmSync(join(foundry.dataPath, 'Data/worlds', id), { recursive: true, force: true });
}
