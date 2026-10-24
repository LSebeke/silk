import { defineConfig } from '@playwright/test';

// Runs against the built module in dist/: `npm run build` first (test:e2e does).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 120_000,
  // Several agents run headless Foundry in parallel; default 5 s flakes under load.
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { browserName: 'chromium', viewport: { width: 1600, height: 900 } },
});
