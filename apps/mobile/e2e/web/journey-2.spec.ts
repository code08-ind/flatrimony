/**
 * Critical journey 2 (docs/03 §8.2): create a listing with photos and an in-app video → listing
 * active. On the app's web build against the real local stack:
 *   My Flat → the six-step editor (Basics, Money, Rules, three photos through the signed upload)
 *   → the walkthrough (recorded only in the Android app: here the app's own upload sequence from
 *     @flatrimony/client sends a 35 s MP4 with a mock Play Integrity token, as a local build does)
 *   → Review (DigiLocker still missing) → Verify with DigiLocker (mock consent page) → Submit
 *   → "Your listing is live" → My Flat "Active · expires in 7 days", and the row is live in the
 *     database with 7 days to run.
 * The Android recorder itself is covered by the Maestro flow e2e/maestro/journey-2.yaml.
 *
 * Photos are drawn fresh for each run (random blocks), so the duplicate-photo check (T3.8) never
 * matches an earlier run. Every run uses a new number and deletes that user afterwards.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { mockIntegrityToken, submitWalkthrough } from '@flatrimony/client';
import { messages } from '@flatrimony/i18n';

const API = process.env.E2E_API_URL ?? 'http://localhost:8080';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const en = messages.en;
const TITLE = 'Bright room near Cyber Hub';

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

const phone = `+9192${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

test.afterAll(async () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('delete from auth.users where phone = $1', [phone.slice(1)]);
  } finally {
    await client.end();
  }
});

/** Three JPEGs of random coloured blocks (a different perceptual hash each run), drawn in the page. */
async function freshPhotos(page: Page) {
  const data = await page.evaluate(() =>
    [0, 1, 2].map(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 900;
      const ctx = canvas.getContext('2d')!;
      for (let x = 0; x < 12; x += 1)
        for (let y = 0; y < 9; y += 1) {
          ctx.fillStyle = `hsl(${Math.floor(Math.random() * 360)}, 60%, ${20 + Math.floor(Math.random() * 60)}%)`;
          ctx.fillRect(x * 100, y * 100, 100, 100);
        }
      return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]!;
    }),
  );
  return data.map((b64, i) => ({
    name: `room-${i + 1}.jpg`,
    mimeType: 'image/jpeg',
    buffer: Buffer.from(b64, 'base64'),
  }));
}

/** A minimal MP4 (ftyp, mdat, moov/mvhd) of `durationS` seconds, created now. */
function walkthroughMp4(durationS: number): Buffer {
  const box = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(Math.floor(Date.now() / 1000) + 2_082_844_800, 4); // seconds since 1904
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(durationS * 1000, 16);
  return Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\0\0isomiso2mp41', 'latin1')),
    box('mdat', Buffer.alloc(64 * 1024, 0x42)),
    box('moov', box('mvhd', mvhd)),
  ]);
}

/**
 * The walkthrough upload the Android app makes after recording (T3.7), through the same
 * @flatrimony/client sequence: upload URL → PUT to storage → SHA-256 → integrity token → confirm.
 */
async function uploadWalkthrough(page: Page, accessToken: string, listingId: string) {
  const bytes = walkthroughMp4(35);
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'x-app-platform': 'android',
    'x-app-version': '0.1.0',
  };
  const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
  return submitWalkthrough(
    listingId,
    {
      uri: 'memory://walkthrough.mp4',
      sizeBytes: bytes.length,
      durationS: 35,
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
    },
    {
      post: async (path, body) => {
        const res = await page.request.post(`${API}/v1${path}`, { headers, data: body as object });
        return { status: res.status(), body: await res.json().catch(() => null) };
      },
      put: async (url) => {
        const res = await page.request.put(url, {
          headers: { 'content-type': 'video/mp4' },
          data: bytes,
        });
        return { status: res.status() };
      },
      fileSha256: async () => sha(bytes),
      textSha256: async (text) => sha(text),
      integrityToken: async (hash) => mockIntegrityToken(hash),
    },
  );
}

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
        device: { deviceId: 'e2e-journey-2', platform: 'web', appVersion: '0.1.0' },
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

test('journey 2: a listing with photos and an in-app video goes live', async ({
  page,
  context,
}) => {
  const session = await onboardedUser(page);
  await page.addInitScript((value) => {
    localStorage.setItem('flatrimony.auth', value);
  }, JSON.stringify(session));
  const ed = en.listing.editor;
  let listingId = '';

  await test.step('My Flat → list the room', async () => {
    await page.goto('/my-flat');
    await expect(page.getByText(en.listing.myFlat.emptyBody)).toBeVisible();
    await page.getByTestId('my-flat-start').click();
    await expect(page.getByRole('heading', { name: ed.basics.heading })).toBeVisible();
  });

  await test.step('Basics', async () => {
    await page.getByTestId('listing-title').fill(TITLE);
    await page.getByText('Cyber City', { exact: true }).first().click();
    await page.getByTestId('listing-location-search').fill('Cyber');
    await page.getByRole('button', { name: /^Cyber City, / }).click();
    await page.getByRole('button', { name: en.onboarding.moveIn.followingMonth }).click();
    await page.getByRole('button', { name: /^15 / }).click();
    await page.getByTestId('listing-next').click();
    await expect(page.getByRole('heading', { name: ed.money.heading })).toBeVisible();
    listingId = /id=([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    expect(listingId).not.toBe('');
  });

  await test.step('Money and Rules', async () => {
    await page.getByTestId('listing-rent').fill('18000');
    await page.getByTestId('listing-deposit').fill('36000');
    await page.getByRole('textbox', { name: ed.money.maintenance }).fill('1500');
    await expect(page.getByText('₹19,500')).toBeVisible();
    await page.getByTestId('listing-next').click();
    await expect(page.getByRole('heading', { name: ed.rules.heading })).toBeVisible();
    await page.getByTestId('listing-next').click();
    await expect(page.getByRole('heading', { name: ed.photos.heading })).toBeVisible();
  });

  await test.step('Photos: three through the signed upload', async () => {
    for (const [i, file] of (await freshPhotos(page)).entries()) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByTestId('listing-add-photo').click(),
      ]);
      await chooser.setFiles(file);
      await expect(page.getByText(`${i + 1}/12`)).toBeVisible({ timeout: 30_000 });
    }
    await page.getByTestId('listing-next').click();
    await expect(page.getByText(ed.video.webTitle)).toBeVisible();
  });

  await test.step('the walkthrough, uploaded as the Android app does', async () => {
    const result = await uploadWalkthrough(page, session.access_token, listingId);
    expect(result).toMatchObject({ ok: true });
    await page.getByTestId('listing-next').click();
    await expect(page.getByRole('heading', { name: ed.review.heading })).toBeVisible();
    await expect(page.getByText(ed.review.videoDone)).toBeVisible();
    await expect(page.getByText('3 photos')).toBeVisible();
    await expect(page.getByText(ed.review.verifyBody)).toBeVisible();
    await expect(page.getByTestId('listing-submit')).toBeDisabled();
  });

  await test.step('Verify with DigiLocker from the review', async () => {
    await page.getByRole('button', { name: ed.review.verifyAction }).click();
    await expect(page.getByRole('heading', { name: en.verification.gate.title })).toBeVisible();
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('verify-start').click(),
    ]);
    await consent(tab, 'MEERA SHARMA');
    await expect(page.getByRole('heading', { name: en.verification.verified.title })).toBeVisible();
    await page.getByTestId('verify-done').click();
    await expect(page.getByRole('heading', { name: ed.review.heading })).toBeVisible();
    // The checklist's identity row is done, so Submit is on.
    await expect(page.getByTestId('listing-submit')).toBeEnabled();
  });

  await test.step('Submit: the listing is live', async () => {
    await page.getByTestId('listing-submit').click();
    await expect(page.getByText(ed.review.liveTitle)).toBeVisible({ timeout: 30_000 });
  });

  await test.step('My Flat shows it active for 7 days', async () => {
    await page.goto('/my-flat');
    const card = page.getByTestId(`listing-${listingId}`);
    await expect(card).toContainText(TITLE);
    await expect(card).toContainText('Active · expires in 7 days');
    await expect(card.getByTestId('listing-still-available')).toBeVisible();
  });

  await test.step('the database agrees: live, published, 7 days, photos and video', async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select l.status, l.published_at is not null as published,
                round(extract(epoch from l.expires_at - now()) / 86400) as days,
                (select count(*) from public.listing_media m where m.listing_id = l.id and m.kind = 'photo')::int as photos,
                (select count(*) from public.listing_media m where m.listing_id = l.id and m.kind = 'walkthrough_video')::int as videos,
                (select count(*) from private.listing_flags f where f.listing_id = l.id)::int as flags
           from public.listings l where l.id = $1`,
        [listingId],
      );
      expect(rows[0]).toEqual({
        status: 'active',
        published: true,
        days: '7',
        photos: 3,
        videos: 1,
        flags: 0,
      });
    } finally {
      await client.end();
    }
  });
});
