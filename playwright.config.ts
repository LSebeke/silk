import { defineConfig } from '@playwright/test';

/** `@perf` tests (spec §14) run only with SILK_PERF=1 (`npm run test:perf`), never by default. */
const perf = process.env['SILK_PERF'] === '1';

// Runs against the built module in dist/: `npm run build` first (test:e2e does).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  ...(perf ? { grep: /@perf/ } : { grepInvert: /@perf/ }),
  workers: 1,
  timeout: 120_000,
  // Several agents run headless Foundry in parallel; default 5 s flakes under load.
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1600, height: 900 },
    // Perf: headless Chromium on the GPU (§14), not SwiftShader.
    ...(perf ? { launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist'] } } : {}),
  },
});
