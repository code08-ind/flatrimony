/**
 * Work and college email badges in the app (T3.3; FR-VER-05) on the real local stack with the
 * API's mock email outbox: Profile → "Work or college email" → a personal address is refused → a
 * work address gets a link → the link is opened (as on another device, through the API) → "I opened
 * the link" shows "Verified company" → the Profile row says so.
 *
 * The user is created through the API and its session is put where the app keeps it. Every run
 * uses a new number and address and deletes that user afterwards.
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
const phone = `+9193${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const address = `asha.${Date.now()}@e2e-corp.co.in`;

test.afterAll(async () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('delete from auth.users where phone = $1', [phone.slice(1)]);
  } finally {
    await client.end();
  }
});

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

test('work email: refused personal address, link sent, opened, badge shown', async ({ page }) => {
  const session = await onboardedUser(page);
  await page.addInitScript((value) => {
    localStorage.setItem('flatrimony.auth', value);
  }, JSON.stringify(session));
  const em = en.verification.email;

  await test.step('Profile offers the optional badge', async () => {
    await page.goto('/profile');
    const row = page.getByTestId('email-badge-row');
    await expect(row).toContainText(en.profile.tiles.emailSub);
    await row.click();
    await expect(page.getByRole('heading', { name: em.title })).toBeVisible();
  });

  await test.step('a personal address is refused before anything is sent', async () => {
    await page.getByTestId('verify-email-input').fill('asha@gmail.com');
    await page.getByTestId('verify-email-send').click();
    await expect(page.getByText(em.errors.personal).first()).toBeVisible();
  });

  await test.step('a work address gets a link', async () => {
    await page.getByTestId('verify-email-input').fill(address);
    await page.getByTestId('verify-email-send').click();
    await expect(page.getByRole('heading', { name: em.sent.title })).toBeVisible();
    await expect(page.getByText(address, { exact: false })).toBeVisible();
    await expect(page.getByTestId('verify-email-resend')).toBeDisabled();
  });

  await test.step('not opened yet: checking says so', async () => {
    await page.getByTestId('verify-email-check').click();
    await expect(page.getByText(em.notYet)).toBeVisible();
  });

  await test.step('the link is opened (another device) and the app shows the badge', async () => {
    const mail = (await (
      await page.request.post(`${API}/dev/email-outbox/latest`, { data: { email: address } })
    ).json()) as { link: string };
    const token = /#token=([A-Za-z0-9_-]{43})$/.exec(mail.link)?.[1];
    expect(token).toBeTruthy();
    const res = await page.request.post(`${API}/v1/verifications/email/confirm`, {
      data: { token },
    });
    expect(await res.json()).toEqual({ status: 'verified', type: 'work_email' });
    await page.getByTestId('verify-email-check').click();
    await expect(page.getByTestId('verify-email-verified')).toContainText(em.verified.work);
  });

  await test.step('the Profile row shows the badge', async () => {
    await page.getByTestId('verify-email-done').click();
    await expect(page.getByTestId('email-badge-row')).toContainText(em.verified.work);
  });
});
