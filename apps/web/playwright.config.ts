import { defineConfig, devices } from '@playwright/test';

/**
 * Web E2E for the web app's own screens (docs/03 §8.1–8.2) against the full local stack:
 * Supabase (Auth with the Send SMS hook, Postgres), the API and its dev SMS outbox.
 *
 * Locally, in the order CI uses:
 *   pnpm dev:secrets && pnpm db:start && pnpm dev:secrets   (the hook secret first, then the keys)
 *   start the API (apps/api: node --env-file=.env.local dist/server.js)
 *   pnpm --filter @flatrimony/web test:e2e
 * This builds the app and serves it on :3000 (the port the API's local CORS allows). Set
 * E2E_BASE_URL (e.g. http://localhost:3000 with `next dev` running) to test that instead.
 */
const external = process.env.E2E_BASE_URL;
const port = 3000;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? `http://localhost:${port}`,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  ...(external
    ? {}
    : {
        webServer: {
          // Always a fresh build, so a run never tests an old one.
          command: `pnpm build && pnpm start`,
          url: `http://localhost:${port}/en`,
          reuseExistingServer: false,
          timeout: 300_000,
        },
      }),
});
