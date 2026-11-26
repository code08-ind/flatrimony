/**
 * The listing walkthrough recorder (T3.7; FR-LST-05) on the app's web build: walkthroughs are
 * recorded only in the Android app, so the web shows "Record on your Android phone" for a listing
 * opened at /listings/{id}/video (the same path the flatrimony:// link opens on Android). The
 * Android recorder itself needs a device (docs/07 T3.7).
 *
 * The user (with a room) and a draft listing are created through the API; the session is put where
 * the app keeps it. Every run uses a new number and deletes that user afterwards.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { messages } from '@flatrimony/i18n';

const API = process.env.E2E_API_URL ?? 'http://localhost:8080';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const en = messages.en;

/** Supabase URL and anon key from the app's local config (pnpm dev:secrets). */
function supabaseConfig() {
  const env = Object.fromEntries(
    readFileSync(join(__dirname, '../../.env.local'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
  return { url: env.EXPO_PUBLIC_SUPABASE_URL!, anon: env.EXPO_PUBLIC_SUPABASE_ANON_KEY! };
}

const phone = `+9195${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

test.afterAll(async () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('delete from auth.users where phone = $1', [phone.slice(1)]);
  } finally {
    await client.end();
  }
});

/** A signed-in user with a room who finished onboarding; returns the Supabase session. */
async function onboardedUser(page: Page): Promise<{ access_token: string }> {
  const sb = supabaseConfig();
  const auth = (path: string, data: object) =>
    page.request.post(`${sb.url}/auth/v1/${path}`, { headers: { apikey: sb.anon }, data });
  expect((await auth('otp', { phone })).ok()).toBe(true);
  const { otp } = (await (
    await page.request.post(`${API}/dev/sms-outbox/latest`, { data: { phone } })
  ).json()) as { otp: string };
  const session = (await (await auth('verify', { type: 'sms', phone, token: otp })).json()) as {
    access_token: string;
  };
  const headers = {
    authorization: `Bearer ${session.access_token}`,
    'x-app-platform': 'web',
    'x-app-version': '0.1.0',
  };
  const writes: [string, 'post' | 'put', object][] = [
    [
      '/me/bootstrap',
      'post',
      {
        displayName: 'Meera',
        dateOfBirth: '1999-01-01',
        intent: 'have_room',
        category: 'professional',
        locale: 'en',
        consents: [
          { purpose: 'terms', version: 'dev-draft' },
          { purpose: 'privacy', version: 'dev-draft' },
        ],
        device: { deviceId: 'e2e-walkthrough', platform: 'web', appVersion: '0.1.0' },
      },
    ],
    [
      '/me/preferences',
      'put',
      {
        budgetMinInr: 10000,
        budgetMaxInr: 20000,
        moveInFrom: '2026-12-01',
        moveInTo: '2026-12-31',
        leaseMonths: 11,
        flatmateGenderPref: 'any',
        areaIds: [1],
      },
    ],
    [
      '/me/lifestyle',
      'put',
      {
        bedtime: '23:00',
        wakeTime: '07:00',
        cleaning: 'daily',
        smoking: 'no',
        pets: 'ok',
        food: 'veg',
      },
    ],
  ];
  for (const [path, method, data] of writes) {
    const res = await page.request[method](`${API}/v1${path}`, { headers, data });
    expect(res.ok(), path).toBe(true);
  }
  return session;
}

test('a walkthrough is recorded on Android: the web says so', async ({ page }) => {
  const session = await onboardedUser(page);
  const created = await page.request.post(`${API}/v1/listings`, {
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'x-app-platform': 'web',
      'x-app-version': '0.1.0',
    },
    data: {
      title: 'Sunny room near Cyber Hub',
      areaId: 1,
      location: { lat: 28.4951, lng: 77.0889 },
      bhk: 3,
      roomType: 'private',
      furnishing: 'semi_furnished',
      availableFrom: '2026-12-15',
      totalFlatmates: 3,
      currentFlatmates: 2,
      rentPerPersonInr: 18000,
      depositPerPersonInr: 36000,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.addInitScript((value) => {
    localStorage.setItem('flatrimony.auth', value);
  }, JSON.stringify(session));

  await page.goto(`/listings/${id}/video`);
  await expect(page.getByRole('heading', { name: en.listing.video.web.title })).toBeVisible();
  await expect(page.getByText(en.listing.video.web.body)).toBeVisible();
  // No camera, upload or gallery on the web.
  await expect(page.getByTestId('walkthrough-open-camera')).toHaveCount(0);
});
