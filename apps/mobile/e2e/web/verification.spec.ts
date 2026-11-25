/**
 * DigiLocker verification in the app (T3.2; FR-VER-01, 03, 07; designs M17/M18) on the real local
 * stack with the API's mock provider: Profile → gate → DigiLocker (a new tab: the mock consent
 * page) → name mismatch → fix the display name → retry → verified → the tile says Verified.
 *
 * The user is created through the API (sign-in with the dev SMS outbox, bootstrap, preferences,
 * habits) and its session is put where the app keeps it, so the test starts on the Profile tab.
 * Every run uses a new number and deletes that user afterwards.
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

/** A signed-in user who finished onboarding as "Asha"; returns the Supabase session. */
async function onboardedUser(page: Page): Promise<unknown> {
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
        displayName: 'Asha',
        dateOfBirth: '1999-01-01',
        intent: 'need_room',
        category: 'professional',
        locale: 'en',
        consents: [
          { purpose: 'terms', version: 'dev-draft' },
          { purpose: 'privacy', version: 'dev-draft' },
        ],
        device: { deviceId: 'e2e-verification', platform: 'web', appVersion: '0.1.0' },
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

/** Completes the mock DigiLocker consent page that the app opened in a new tab. */
async function consent(tab: Page, name: string) {
  await tab.waitForLoadState();
  await expect(tab.getByRole('heading', { name: 'DigiLocker (test)' })).toBeVisible();
  await tab.getByLabel('Name on the documents').fill(name);
  await tab.getByLabel('Date of birth').fill('1998-08-15');
  await tab.getByLabel('Gender').selectOption('female');
  await tab.getByRole('button', { name: 'Allow' }).click();
  await expect(tab.getByRole('heading', { name: 'Done' })).toBeVisible();
  await tab.close();
}

test('verify with DigiLocker: name mismatch → fix the name → verified', async ({
  page,
  context,
}) => {
  const session = await onboardedUser(page);
  await page.addInitScript((value) => {
    localStorage.setItem('flatrimony.auth', value);
  }, JSON.stringify(session));

  await test.step('Profile → the verification gate', async () => {
    await page.goto('/profile');
    await page.getByTestId('verification-tile').click();
    await expect(page.getByRole('heading', { name: en.verification.gate.title })).toBeVisible();
    await expect(page.getByText(en.verification.gate.consent)).toBeVisible();
  });

  await test.step('DigiLocker returns another first name: name mismatch', async () => {
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('verify-start').click(),
    ]);
    await consent(tab, 'MEERA SHARMA');
    await expect(
      page.getByRole('heading', { name: en.verification.failed.nameMismatch.title }),
    ).toBeVisible();
  });

  await test.step('fix the display name and retry: verified', async () => {
    await page.getByTestId('verify-name').fill('Meera');
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('verify-update-name').click(),
    ]);
    await consent(tab, 'MEERA SHARMA');
    await expect(page.getByRole('heading', { name: en.verification.verified.title })).toBeVisible();
    // Age from the DigiLocker date of birth, never the name or the date itself.
    // (the Profile tab underneath in the stack shows it too: the newest screen is last)
    await expect(page.getByText(/^Meera, \d+$/).last()).toBeVisible();
  });

  await test.step('back on Profile the tile says Verified', async () => {
    await page.getByTestId('verify-done').click();
    await expect(page.getByTestId('verification-tile')).toContainText(en.profile.tiles.verified);
  });
});
