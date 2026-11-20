import { defineConfig, devices } from '@playwright/test';

/**
 * Web E2E for the critical journeys (docs/03 §8.1–8.2) on the app's web build, against the full
 * local stack: Supabase (Auth with the Send SMS hook, Postgres), the API and its dev SMS outbox.
 *
 * Locally, in the order CI uses:
 *   pnpm dev:secrets && pnpm db:start && pnpm dev:secrets   (the hook secret first, then the keys)
 *   start the API (apps/api: node --env-file=.env.local dist/server.js)
 *   pnpm --filter @flatrimony/mobile test:e2e:web
 * This exports the app for web and serves it on :8081 (the port the API's local CORS allows). Set
 * E2E_BASE_URL (e.g. http://localhost:8081 with `expo start --web` running) to test that instead.
 */
const external = process.env.E2E_BASE_URL;
// The API's local CORS allow-list has the Expo web port (scripts/dev-secrets.mjs).
const port = 8081;

export default defineConfig({
  testDir: 'e2e/web',
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
    // Android-sized viewport: the app is designed for phones (docs/06).
    ...devices['Pixel 7'],
  },
  ...(external
    ? {}
    : {
        webServer: {
          // Always a fresh export, so a run never tests an old build.
          command: `pnpm export:web && node e2e/serve-web.mjs dist-web ${port}`,
          url: `http://localhost:${port}`,
          reuseExistingServer: false,
          timeout: 300_000,
        },
      }),
});
