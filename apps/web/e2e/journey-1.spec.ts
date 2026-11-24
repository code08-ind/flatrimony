/**
 * Critical journey 1 on the web app (docs/03 §8.2; PRD §6.1 steps 1–4): sign up with phone OTP →
 * onboarding → saved, on the real local stack: the browser → Supabase Auth /otp → Send SMS hook
 * (the API) → mock SMS provider → the API's dev outbox (local only) → Supabase Auth /verify → the
 * session cookie (/api/session) → the API through /api/v1. Also checks what the web session adds:
 * HttpOnly cookies, token refresh, sign-out, cross-site writes refused, and axe on each screen.
 * Every run uses a new random number and deletes that user afterwards (profile rows cascade).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { messages } from '@flatrimony/i18n';

const API = process.env.E2E_API_URL ?? 'http://localhost:8080';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const en = messages.en;

const national = `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const phone = `+91${national}`;

async function db<T>(sql: string, params: unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

test.afterAll(async () => {
  await db('delete from auth.users where phone = $1', [phone.slice(1)]);
});

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

/** No serious or critical WCAG 2.1 A/AA problems on the page (docs/03 §8.1). */
async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
}

const next = (page: Page) => page.getByTestId('continue').click();
const choose = (page: Page, group: string, option: string) =>
  page
    .getByRole('group', { name: group })
    .getByRole('radio', { name: option, exact: true })
    .check();

test('journey 1 on the web: sign up with OTP → onboarding → saved', async ({ page, context }) => {
  await test.step('landing → sign-in → code sent', async () => {
    await page.goto('/en');
    await page.getByRole('link', { name: en.web.getStarted }).click();
    await expect(page.getByRole('heading', { name: en.auth.phone.title })).toBeVisible();
    await accessible(page);
    await page.getByLabel(en.auth.phone.label).fill(national);
    await page.getByTestId('send-code').click();
    await expect(page.getByRole('heading', { name: en.auth.otp.title })).toBeVisible();
  });

  await test.step('wrong code → error; the real code → signed in, tokens out of reach', async () => {
    const otp = await latestOtp(page);
    const code = page.getByLabel(en.auth.otp.codeLabel);
    await code.fill(`${(Number(otp[0]) + 1) % 10}${otp.slice(1)}`);
    await expect(page.getByText(en.auth.otp.wrongCode)).toBeVisible();
    await code.fill(otp);
    await expect(page).toHaveURL(/\/en\/onboarding\/about$/);
    const cookies = await context.cookies();
    for (const name of ['fl_at', 'fl_rt'])
      expect(cookies.find((c) => c.name === name)).toMatchObject({
        httpOnly: true,
        sameSite: 'Lax',
      });
    expect(await page.evaluate(() => document.cookie)).toBe('');
  });

  await test.step('about you', async () => {
    await expect(page.getByRole('heading', { name: en.onboarding.about.title })).toBeVisible();
    await accessible(page);
    await page.getByLabel(en.onboarding.about.nameLabel).fill('Asha');
    await page.getByLabel(en.onboarding.about.dayLabel).fill('15');
    await page.getByLabel(en.onboarding.about.monthLabel).fill('08');
    await page.getByLabel(en.onboarding.about.yearLabel).fill('1998');
    await next(page);
  });

  await test.step('intent and category (the account is created)', async () => {
    await page.getByRole('radio', { name: en.onboarding.intent.needRoom }).check();
    await next(page);
    await page.getByRole('radio', { name: en.onboarding.category.professional }).check();
    await next(page);
    await expect(page.getByRole('heading', { name: en.onboarding.budget.title })).toBeVisible();
  });

  await test.step('budget', async () => {
    await choose(page, en.onboarding.budget.quick, en.onboarding.budget['20_30k']);
    await next(page);
  });

  await test.step('office with its commute zone', async () => {
    await expect(page.getByRole('heading', { name: en.anchor.title })).toBeVisible();
    await page.getByRole('searchbox', { name: en.anchor.searchLabel }).fill('Cyber');
    await page.getByRole('button', { name: /^Cyber City/ }).click();
    await expect(page.getByRole('img', { name: /^Commute zone from Cyber City/ })).toBeVisible();
    await accessible(page);
    await next(page);
  });

  await test.step('move-in window (the preferences are saved)', async () => {
    await choose(page, en.onboarding.moveIn.title, en.onboarding.moveIn.next_month);
    await next(page);
  });

  await test.step('habits → saved', async () => {
    await expect(page.getByRole('heading', { name: en.onboarding.habits.title })).toBeVisible();
    const h = en.onboarding.habits;
    await choose(page, h.bedtime, h.by_11pm);
    await choose(page, h.wakeTime, h.by_7am);
    await choose(page, h.cleaning, h.daily);
    await choose(page, h.smoking, h.no);
    await choose(page, h.pets, h.ok);
    await choose(page, h.food, h.veg);
    await accessible(page);
    await page.getByTestId('finish').click();
    await expect(page.getByRole('heading', { name: en.web.savedTitle })).toBeVisible();
    const [row] = await db<{ display_name: string; anchors: number; lifestyle: number }>(
      `select p.display_name,
              (select count(*)::int from public.anchors a where a.user_id = p.id) as anchors,
              (select count(*)::int from public.lifestyle l where l.user_id = p.id) as lifestyle
         from public.profiles p join auth.users u on u.id = p.id
        where u.phone = $1`,
      [phone.slice(1)],
    );
    expect(row).toEqual({ display_name: 'Asha', anchors: 1, lifestyle: 1 });
  });

  await test.step('an unusable access token is renewed from the refresh token', async () => {
    const url = new URL(page.url());
    await context.addCookies([
      {
        name: 'fl_at',
        value: 'expired.or.broken',
        domain: url.hostname,
        path: '/',
        httpOnly: true,
      },
    ]);
    await page.reload();
    await expect(page.getByRole('heading', { name: en.web.savedTitle })).toBeVisible();
    const renewed = (await context.cookies()).find((c) => c.name === 'fl_at')?.value;
    expect(renewed).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(renewed).not.toBe('expired.or.broken');
  });

  await test.step('writes from another site are refused', async () => {
    const res = await page.request.post('/api/v1/me/bootstrap', {
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(403);
  });

  await test.step('sign out → signed-in pages send you to sign-in', async () => {
    await page.getByRole('button', { name: en.web.signOut }).click();
    await expect(page).toHaveURL(/\/en$/);
    expect((await context.cookies()).filter((c) => c.name.startsWith('fl_'))).toEqual([]);
    await page.goto('/en/onboarding');
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });
});
