/**
 * The web listing editor and My Flat (T3.9b; FR-LST-05; docs/06 §8.12) against the real local
 * stack: an empty My Flat → "List your room" → Basics (title, area, pin from the place search,
 * date) → a reload keeps the draft and the step → Money (live all-in total) → Rules → Photos (real
 * JPEGs: the signed upload URL through this site's /api/v1, the file PUT to Storage, the confirm;
 * one removed again) → Video ("Continue on your phone": the QR code decodes to
 * flatrimony://listings/{id}/video) → Review (the walkthrough and DigiLocker are missing, so it
 * cannot be submitted) → back in My Flat the draft continues at step 5. Axe on every step.
 *
 * The member (with a room, onboarded) is created through Supabase Auth and the API; the session
 * is handed to this site like the sign-in page does. Every run uses a new number and deletes that
 * user afterwards (the listing rows cascade).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { messages } from '@flatrimony/i18n';

const API = process.env.E2E_API_URL ?? 'http://localhost:8080';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const en = messages.en;
const ed = en.listing.editor;
const PHOTOS = ['047b1998cb56.jpg', '0a26d5059a39.jpg', '0d12adc9d1e2.jpg', '0e1d807d3530.jpg'].map(
  (f) => join(import.meta.dirname, '../../../docs/designs/assets/img', f),
);
const JSQR = createRequire(import.meta.url).resolve('jsqr/dist/jsQR.js');

const phone = `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

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

/** Supabase URL and anon key from the web app's local config (pnpm dev:secrets). */
function supabaseConfig() {
  const env = Object.fromEntries(
    readFileSync(join(import.meta.dirname, '../.env.local'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
  return {
    url: process.env.E2E_SUPABASE_URL ?? env.SUPABASE_URL!,
    anon: process.env.E2E_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY!,
  };
}

/** A member with a room who finished onboarding, signed in to this site (HttpOnly cookies). */
async function signedInOwner(page: Page, baseURL: string) {
  const sb = supabaseConfig();
  const auth = (path: string, data: object) =>
    page.request.post(`${sb.url}/auth/v1/${path}`, { headers: { apikey: sb.anon }, data });
  expect((await auth('otp', { phone })).ok()).toBe(true);
  let otp: string | undefined;
  await expect
    .poll(async () => {
      const res = await page.request.post(`${API}/dev/sms-outbox/latest`, { data: { phone } });
      otp = res.ok() ? ((await res.json()) as { otp?: string }).otp : undefined;
      return otp;
    })
    .toMatch(/^\d{6}$/);
  const session = (await (await auth('verify', { type: 'sms', phone, token: otp })).json()) as {
    access_token: string;
    refresh_token: string;
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
        displayName: 'Kavya',
        dateOfBirth: '1998-04-02',
        intent: 'have_room',
        category: 'professional',
        locale: 'en',
        consents: [
          { purpose: 'terms', version: 'dev-draft' },
          { purpose: 'privacy', version: 'dev-draft' },
        ],
        device: { deviceId: 'e2e-web-listing-editor', platform: 'web', appVersion: '0.1.0' },
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
  const handed = await page.request.post('/api/session', {
    headers: { origin: new URL(baseURL).origin },
    data: { accessToken: session.access_token, refreshToken: session.refresh_token },
  });
  expect(handed.status()).toBe(204);
}

/** No serious or critical WCAG 2.1 A/AA problems on the page (docs/03 §8.1). */
async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
}

const heading = (page: Page, name: string) =>
  expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
const next = (page: Page) => page.getByTestId('listing-next').click();
/** A date a month from now (the room is free from then). */
const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

test('list a room on the web: every step, the QR for the phone, continued from My Flat', async ({
  page,
  baseURL,
}) => {
  await signedInOwner(page, baseURL!);
  let listingId = '';

  await test.step('home → an empty My Flat offers to list the room', async () => {
    await page.goto('/en/home');
    await page.getByTestId('home-my-flat').click();
    await expect(page.getByText(en.listing.myFlat.emptyBody)).toBeVisible();
    await accessible(page);
    await page.getByTestId('my-flat-start').click();
    await heading(page, ed.basics.heading);
  });

  await test.step('Basics: Next says what is missing, then creates the draft', async () => {
    await next(page);
    await expect(page.getByText(ed.basics.errors.title)).toBeVisible();
    await page.getByLabel(ed.basics.titleLabel).fill('Sunny room near Cyber Hub');
    await page
      .getByRole('group', { name: en.onboarding.commute.cities.gurugram })
      .getByRole('radio', { name: 'Cyber City', exact: true })
      .check();
    await page.getByLabel(ed.basics.availableFrom).fill('2020-01-01');
    await next(page);
    await expect(page.getByText(ed.basics.errors.location)).toBeVisible();
    await page.getByRole('searchbox', { name: ed.basics.searchLabel }).fill('Cyber');
    await page.getByRole('button', { name: /^Cyber City/ }).click();
    // Typed while the place loads: kept when the pin arrives.
    await page.getByLabel(ed.basics.addressLabel).fill('Tower B');
    await expect(page.getByRole('button', { name: ed.basics.changeLocation })).toBeVisible();
    await expect(page.getByLabel(ed.basics.addressLabel)).toHaveValue('Tower B');
    await next(page);
    await expect(page.getByText(ed.basics.errors.availableFromPast)).toBeVisible();
    await page.getByLabel(ed.basics.availableFrom).fill(inAMonth());
    await page.getByRole('radio', { name: '3 BHK' }).check();
    await accessible(page);
    await next(page);
    await heading(page, ed.money.heading);
    await expect(page).toHaveURL(/\?id=[0-9a-f-]{36}&step=money$/);
    listingId = new URL(page.url()).searchParams.get('id')!;
  });

  await test.step('a reload keeps the draft and the step (the URL names both)', async () => {
    await page.reload();
    await heading(page, ed.money.heading);
  });

  await test.step('Money: the all-in total adds up as you type', async () => {
    await page.getByLabel(ed.money.rent).fill('18000.5');
    await next(page);
    await expect(page.getByText(ed.money.errors.rent)).toBeVisible();
    await page.getByLabel(ed.money.rent).fill('18000');
    await page.getByLabel(ed.money.deposit).fill('36000');
    await page.getByLabel(ed.money.maintenance).fill('1500');
    await expect(page.getByTestId('listing-total')).toContainText('₹19,500');
    await accessible(page);
    await next(page);
    await heading(page, ed.rules.heading);
  });

  await test.step('Rules: pets allowed, veg kitchen', async () => {
    await page.getByRole('checkbox', { name: new RegExp(`^${ed.rules.pets}`) }).check();
    await page
      .getByRole('group', { name: ed.rules.food })
      .getByRole('radio', { name: ed.rules.foodVeg })
      .check();
    await accessible(page);
    await next(page);
    await heading(page, ed.photos.heading);
  });

  await test.step('Photos: real JPEGs through the signed upload; one removed again', async () => {
    for (const [i, file] of PHOTOS.entries()) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByTestId('listing-add-photo').click(),
      ]);
      await chooser.setFiles(file);
      await expect(page.getByText(`${i + 1}/12`)).toBeVisible({ timeout: 60_000 });
    }
    await expect(page.getByText(ed.photos.cover, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove photo 4' }).click();
    const dialog = page.getByRole('dialog', { name: ed.photos.removeTitle });
    await expect(dialog).toBeVisible();
    await accessible(page);
    await dialog.getByRole('button', { name: ed.photos.removeConfirm }).click();
    await expect(page.getByText('3/12')).toBeVisible();
    await expect(page.getByRole('img', { name: /^Photo \d$/ })).toHaveCount(3);
    await next(page);
  });

  await test.step('Video: continue on the Android phone with the QR code', async () => {
    await heading(page, ed.video.heading);
    await expect(page.getByText(ed.video.handover.title)).toBeVisible();
    await expect(page.getByRole('button', { name: /send link/i })).toHaveCount(0);
    const qr = page.getByRole('img', { name: ed.video.handover.qrLabel });
    await expect(qr).toBeVisible();
    // Decode what is drawn: the QR's path on a white canvas, read by jsQR.
    await page.addScriptTag({ path: JSQR });
    const decoded = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="listing-video-qr"]') as SVGSVGElement;
      const size = svg.viewBox.baseVal.width;
      const scale = 8;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.fillStyle = 'black';
      ctx.fill(new Path2D(svg.querySelector('path')!.getAttribute('d')!));
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const jsQR = (window as unknown as { jsQR: (...a: unknown[]) => { data: string } | null })
        .jsQR;
      return jsQR(img.data, img.width, img.height)?.data ?? null;
    });
    expect(decoded).toBe(`flatrimony://listings/${listingId}/video`);
    await page.getByTestId('listing-video-check').click();
    await expect(page.getByText(ed.video.handover.notYet).first()).toBeVisible();
    await accessible(page);
    await next(page);
  });

  await test.step('Review: the walkthrough and DigiLocker are missing, so no submit', async () => {
    await heading(page, ed.review.heading);
    await expect(page.getByText('₹19,500 all-in').first()).toBeVisible();
    await expect(page.getByText('3 photos')).toBeVisible();
    await expect(page.getByTestId('check-video')).toContainText(ed.review.missing);
    await expect(page.getByTestId('check-verification')).toContainText(ed.review.verifyBody);
    await expect(page.getByTestId('listing-submit')).toBeDisabled();
    await accessible(page);
  });

  await test.step('what was saved: the draft with its costs, rules and three photos', async () => {
    const [row] = await db<{
      status: string;
      bhk: number;
      rent: number;
      maintenance: number;
      pets: boolean;
      food: string;
      photos: number;
    }>(
      `select l.status, l.bhk, l.rent_per_person_inr as rent, c.maintenance_inr as maintenance,
              r.pets_allowed as pets, r.food_rule as food,
              (select count(*)::int from public.listing_media m
                where m.listing_id = l.id and m.kind = 'photo') as photos
         from public.listings l
         join public.listing_costs c on c.listing_id = l.id
         join public.listing_rules r on r.listing_id = l.id
        where l.id = $1`,
      [listingId],
    );
    expect(row).toEqual({
      status: 'draft',
      bhk: 3,
      rent: 18000,
      maintenance: 1500,
      pets: true,
      food: 'veg_only',
      photos: 3,
    });
  });

  await test.step('My Flat: the draft continues at the Video step', async () => {
    await page.getByRole('button', { name: en.common.back }).click(); // Review → Video
    await page.goto('/en/my-flat');
    await expect(page.getByText('Sunny room near Cyber Hub')).toBeVisible();
    await expect(page.getByText('Draft · step 5 of 6')).toBeVisible();
    await accessible(page);
    await page.getByTestId('listing-continue').click();
    await heading(page, ed.video.heading);
    await expect(page).toHaveURL(new RegExp(`id=${listingId}&step=video$`));
  });
});
