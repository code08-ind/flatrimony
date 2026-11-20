import { defineConfig, devices } from '@playwright/test';

/**
 * Web E2E for the critical journeys (docs/03 §8.1–8.2) on the app's web build, against the full
 * local stack: Supabase (Auth with the Send SMS hook, Postgres), the API and its dev SMS outbox.
 *
 * Locally: `pnpm db:start`, `pnpm dev:secrets`, start the API, then
 *   pnpm --filter @flatrimony/mobile test:e2e:web
 * The app is served from E2E_BASE_URL when set (e.g. a running `expo start --web` on :8081);
 * otherwise a fresh web export is built and served on :8081 (what CI does).
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
          command: `node e2e/serve-web.mjs dist-web ${port}`,
          url: `http://localhost:${port}`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
});
