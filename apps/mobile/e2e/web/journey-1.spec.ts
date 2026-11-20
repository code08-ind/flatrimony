/**
 * Critical journey 1 (docs/03 §8.2; PRD §6.1 steps 1–4): sign up with phone OTP → onboarding →
 * Discover, then the Profile tab shows the 40 % that onboarding earns (FR-AUTH-06 AC).
 *
 * Runs the real stack end to end: the app's web build → Supabase Auth /otp → Send SMS hook (the
 * API, signed) → mock SMS provider → the API's dev outbox (local only) → Supabase Auth /verify →
 * POST /v1/me/bootstrap and the onboarding writes. Every run uses a new random number and deletes
 * that user afterwards (profile rows cascade).
 */
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { messages } from '@flatrimony/i18n';

const API = process.env.E2E_API_URL ?? 'http://localhost:8080';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const en = messages.en;

/** A fresh Indian mobile number (+91 98xxxxxxxx) so runs never collide. */
const national = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const phone = `+91${national}`;

test.afterAll(async () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('delete from auth.users where phone = $1', [phone.slice(1)]);
  } finally {
    await client.end();
  }
});

/** Taps digits on the app's on-screen keypad (phone and OTP screens). */
async function keypad(page: Page, digits: string) {
  for (const d of digits) await page.getByTestId(`key-${d}`).last().click();
}

/** The code the mock SMS provider "sent" (the API's dev outbox; never available in production). */
async function latestOtp(page: Page): Promise<string> {
  let otp: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.post(`${API}/dev/sms-outbox/latest`, { data: { phone } });
        otp = res.ok() ? ((await res.json()) as { otp?: string }).otp : undefined;
        return otp;
      },
      { message: 'OTP reached the dev outbox', timeout: 15_000 },
    )
    .toMatch(/^\d{6}$/);
  return otp!;
}

/**
 * The Continue button of the screen on top. Onboarding is a stack: earlier screens stay mounted
 * underneath with the same testID, and the newest one is rendered last.
 */
const next = (page: Page) => page.getByTestId('continue').last().click();

const option = (page: Page, title: string) =>
  page.getByRole('radio', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

test('journey 1: sign up with OTP → onboarding → Discover', async ({ page }) => {
  await test.step('welcome: continue in English', async () => {
    await page.goto('/');
    await page.getByTestId('continue-en').click();
    await expect(page.getByRole('heading', { name: en.auth.phone.title })).toBeVisible();
  });

  await test.step('phone number → code sent', async () => {
    await keypad(page, national);
    await page.getByTestId('send-code').click();
    await expect(page.getByRole('heading', { name: en.auth.otp.title })).toBeVisible();
  });

  await test.step('OTP → signed in', async () => {
    // The sixth digit submits the code (no Verify tap needed).
    await keypad(page, await latestOtp(page));
    await expect(page.getByLabel(en.onboarding.about.nameLabel)).toBeVisible();
  });

  await test.step('about you: first name and date of birth', async () => {
    await page.getByLabel(en.onboarding.about.nameLabel).fill('Asha');
    await page.getByLabel(en.onboarding.about.dayLabel).fill('15');
    await page.getByLabel(en.onboarding.about.monthLabel).fill('08');
    await page.getByLabel(en.onboarding.about.yearLabel).fill('1998');
    await next(page);
  });

  await test.step('intent and category', async () => {
    await option(page, en.onboarding.intent.needRoom).click();
    await next(page);
    await option(page, en.onboarding.category.professional).click();
    await next(page);
  });

  await test.step('budget (defaults)', async () => {
    await expect(page.getByRole('heading', { name: en.onboarding.budget.title })).toBeVisible();
    await next(page);
  });

  await test.step('areas: pick one', async () => {
    await expect(page.getByRole('heading', { name: en.onboarding.commute.title })).toBeVisible();
    await page.getByRole('checkbox').first().click();
    await next(page);
  });

  await test.step('move-in: next month', async () => {
    await expect(page.getByRole('heading', { name: en.onboarding.moveIn.title })).toBeVisible();
    await page.getByRole('radio', { name: en.onboarding.moveIn.next_month, exact: true }).click();
    await next(page);
  });

  await test.step('habits: answer all six → Discover', async () => {
    await expect(page.getByRole('heading', { name: en.onboarding.habits.title })).toBeVisible();
    for (const group of ['bedtime', 'wakeTime', 'cleaning', 'smoking', 'pets', 'food'] as const)
      await page
        .getByRole('radiogroup', { name: en.onboarding.habits[group] })
        .getByRole('radio')
        .first()
        .click();
    await page.getByTestId('finish').click();
    await expect(page.getByRole('heading', { name: en.tabs.discover })).toBeVisible();
  });

  await test.step('Profile tab: onboarding earns 40 %', async () => {
    await page.getByRole('tab', { name: en.tabs.profile }).click();
    await expect(page.getByText('Asha, ', { exact: false }).first()).toBeVisible();
    await expect(
      page.getByRole('progressbar', {
        name: new RegExp(en.profile.complete.replace('{percent}', '40')),
      }),
    ).toBeVisible();
  });
});
