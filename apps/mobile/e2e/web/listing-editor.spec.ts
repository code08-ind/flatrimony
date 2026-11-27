/**
 * The listing editor and My Flat (T3.9; docs/06 §8.12; designs M28–M33) on the app's web build,
 * against the real local stack: an empty My Flat → "List your room" → Basics (title, area, pin from
 * the place search, date) → Money (live all-in total) → Rules → Photos (three real JPEGs through the
 * signed upload) → Video (web: continue on the Android phone) → Review (what is still missing; the
 * walkthrough and DigiLocker are) → back in My Flat the draft continues at step 5.
 *
 * The user (with a room) is created through the API; the session is put where the app keeps it.
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
const PHOTOS = ['047b1998cb56.jpg', '0a26d5059a39.jpg', '0d12adc9d1e2.jpg'].map((f) =>
  join(__dirname, '../../../../docs/designs/assets/img', f),
);

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
        device: { deviceId: 'e2e-listing-editor', platform: 'web', appVersion: '0.1.0' },
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

test('list a room: six steps, saved as a draft, continued from My Flat', async ({ page }) => {
  const session = await onboardedUser(page);
  await page.addInitScript((value) => {
    localStorage.setItem('flatrimony.auth', value);
  }, JSON.stringify(session));
  const ed = en.listing.editor;

  await test.step('an empty My Flat offers to list the room', async () => {
    await page.goto('/my-flat');
    await expect(page.getByText(en.listing.myFlat.emptyBody)).toBeVisible();
    await page.getByTestId('my-flat-start').click();
    await expect(page.getByRole('heading', { name: ed.basics.heading })).toBeVisible();
  });

  await test.step('Basics: Next says what is missing, then saves the draft', async () => {
    await page.getByTestId('listing-next').click();
    await expect(page.getByText(ed.basics.errors.title)).toBeVisible();
    await page.getByTestId('listing-title').fill('Sunny room near Cyber Hub');
    await page.getByText('Cyber City', { exact: true }).first().click();
    await page.getByTestId('listing-location-search').fill('Cyber');
    await page.getByRole('button', { name: /^Cyber City, / }).click();
    await expect(page.getByText(ed.basics.locationPrivate)).toBeVisible();
    await page.getByRole('button', { name: en.onboarding.moveIn.followingMonth }).click();
    await page.getByRole('button', { name: /^15 / }).click();
    await page.getByTestId('listing-next').click();
    await expect(page.getByRole('heading', { name: ed.money.heading })).toBeVisible();
  });

  await test.step('a reload keeps the draft and the step (the URL names both)', async () => {
    await expect(page).toHaveURL(/id=[0-9a-f-]{36}/);
    await page.reload();
    await expect(page.getByRole('heading', { name: ed.money.heading })).toBeVisible();
  });

  await test.step('Money: the all-in total adds up as you type', async () => {
    // A decimal part is dropped, never run into the digits (18000.5 is not ₹1,80,005).
    await page.getByTestId('listing-rent').fill('18000.5');
    await expect(page.getByTestId('listing-rent')).toHaveValue('18000');
    await page.getByTestId('listing-rent').fill('18000');
    await page.getByTestId('listing-deposit').fill('36000');
    await page.getByRole('textbox', { name: ed.money.maintenance }).fill('1500');
    await expect(page.getByText('₹19,500')).toBeVisible();
    await page.getByTestId('listing-next').click();
    await expect(page.getByRole('heading', { name: ed.rules.heading })).toBeVisible();
  });

  await test.step('Rules: defaults are fine', async () => {
    await page.getByTestId('listing-next').click();
    await expect(page.getByRole('heading', { name: ed.photos.heading })).toBeVisible();
  });

  await test.step('Photos: three real photos through the signed upload', async () => {
    for (const [i, file] of PHOTOS.entries()) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByTestId('listing-add-photo').click(),
      ]);
      await chooser.setFiles(file);
      await expect(page.getByText(`${i + 1}/12`)).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.getByText(ed.photos.cover, { exact: true })).toBeVisible();
    await page.getByTestId('listing-next').click();
  });

  await test.step('Video: recorded on the Android phone', async () => {
    await expect(page.getByText(ed.video.webTitle)).toBeVisible();
    await page.getByTestId('listing-next').click();
  });

  await test.step('Review: the walkthrough and DigiLocker are still missing', async () => {
    await expect(page.getByRole('heading', { name: ed.review.heading })).toBeVisible();
    await expect(page.getByText('₹19,500 all-in').first()).toBeVisible();
    await expect(page.getByText('3 photos')).toBeVisible();
    await expect(page.getByText(ed.review.verifyBody)).toBeVisible();
    await expect(page.getByTestId('listing-submit')).toBeDisabled();
  });

  await test.step('My Flat: the draft continues where it stopped', async () => {
    await page.goto('/my-flat');
    await expect(page.getByText('Sunny room near Cyber Hub')).toBeVisible();
    await expect(page.getByText('Draft · step 5 of 6')).toBeVisible();
    await page.getByRole('button', { name: en.listing.myFlat.continue }).click();
    await expect(page.getByText(ed.video.webTitle)).toBeVisible();
  });
});
