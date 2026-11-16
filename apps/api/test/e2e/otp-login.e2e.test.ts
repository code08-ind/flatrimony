/**
 * End-to-end phone OTP sign-in against a running local stack (T2.2):
 *   client → Supabase Auth /otp → Send SMS hook (this API, signed) → mock provider →
 *   dev outbox → Supabase Auth /verify → access token → this API's JWT verifier.
 * Plus the hardening found by manual QA: phone OTP is the ONLY way in.
 *
 * Run with the full local stack and the API up (docs/07 T2.2):
 *   E2E_SUPABASE_URL=http://127.0.0.1:54321 E2E_SUPABASE_ANON_KEY=<anon key> \
 *   E2E_API_URL=http://127.0.0.1:8080 [E2E_DATABASE_URL=postgresql://…:54322/postgres] \
 *   pnpm --filter @flatrimony/api test:e2e
 * Skipped when the first three variables are not set.
 */
import { randomBytes, randomInt } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createJwtVerifier } from '../../src/plugins/auth.js';

const SUPABASE = process.env.E2E_SUPABASE_URL;
const ANON = process.env.E2E_SUPABASE_ANON_KEY;
const API = process.env.E2E_API_URL;
const DB = process.env.E2E_DATABASE_URL;

const created: string[] = [];
const indianPhone = () => {
  const p = `+9198${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  created.push(p.slice(1));
  return p;
};

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

describe.skipIf(!SUPABASE || !ANON || !API)('phone OTP sign-in (local stack)', () => {
  const auth = (path: string, body: unknown, token?: string, method = 'POST') =>
    fetch(`${SUPABASE}/auth/v1/${path}`, {
      method,
      headers: {
        apikey: ANON!,
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const latestOtp = async (phone: string) => {
    const res = await fetch(`${API}/dev/sms-outbox/latest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    return (await json(res)).otp as string | null;
  };
  const verifier = createJwtVerifier({
    issuer: `${SUPABASE}/auth/v1`,
    jwksUrl: `${SUPABASE}/auth/v1/.well-known/jwks.json`,
  });

  async function signIn(phone: string) {
    expect((await auth('otp', { phone })).status).toBe(200);
    const otp = await latestOtp(phone);
    expect(otp).toMatch(/^\d{6}$/);
    const session = await json(await auth('verify', { type: 'sms', phone, token: otp }));
    expect(typeof session.access_token).toBe('string');
    return { session, otp: otp! };
  }

  afterAll(async () => {
    if (!DB || created.length === 0) return;
    const client = new pg.Client({ connectionString: DB });
    await client.connect();
    await client.query('delete from auth.users where phone = any($1)', [created]);
    await client.end();
  });

  it('signs in with an Indian number; the API accepts the token; refresh works', async () => {
    const phone = indianPhone();
    expect((await auth('otp', { phone })).status).toBe(200);
    const otp = await latestOtp(phone);

    const wrong = await auth('verify', {
      type: 'sms',
      phone,
      token: otp === '000000' ? '111111' : '000000',
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const session = await json(await auth('verify', { type: 'sms', phone, token: otp }));
    const userId = (session.user as { id: string }).id;
    await expect(verifier(session.access_token as string)).resolves.toMatchObject({
      id: userId,
      appRole: 'user',
    });

    // The same OTP cannot be used twice.
    expect(
      (await auth('verify', { type: 'sms', phone, token: otp })).status,
    ).toBeGreaterThanOrEqual(400);

    // Refresh keeps the OTP-established session valid for the API.
    const refreshed = await json(
      await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token }),
    );
    await expect(verifier(refreshed.access_token as string)).resolves.toMatchObject({ id: userId });
  });

  it('enforces the 30 s resend interval', async () => {
    const phone = indianPhone();
    expect((await auth('otp', { phone })).status).toBe(200);
    const again = await auth('otp', { phone });
    expect(again.status).toBe(429);
  });

  it('refuses non-Indian numbers before any user is created', async () => {
    const phone = `+1415555${String(randomInt(1000, 9999))}`;
    created.push(phone.slice(1));
    const res = await auth('otp', { phone });
    expect(res.status).toBeGreaterThanOrEqual(400);
    if (DB) {
      const client = new pg.Client({ connectionString: DB });
      await client.connect();
      const { rows } = await client.query(
        'select count(*)::int as n from auth.users where phone = $1',
        [phone.slice(1)],
      );
      await client.end();
      expect(rows[0].n).toBe(0);
    }
  });

  it('a phone + password signup gives no session, and passwords never sign in', async () => {
    const phone = indianPhone();
    const password = randomBytes(18).toString('base64url');
    const signup = await json(await auth('signup', { phone, password }));
    expect(signup.access_token).toBeUndefined();

    // Even after the real owner confirms the number with the OTP that signup sent, the password is useless.
    const otp = await latestOtp(phone);
    expect(otp).toMatch(/^\d{6}$/);
    expect((await auth('verify', { type: 'sms', phone, token: otp })).status).toBe(200);
    const pw = await auth('token?grant_type=password', { phone, password });
    expect(pw.status).toBeGreaterThanOrEqual(400);
  });

  it('email signups are refused', async () => {
    const res = await auth('signup', {
      email: `qa-${randomInt(1e9)}@example.test`,
      password: randomBytes(18).toString('base64url'),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it(
    'changing the phone number needs an OTP sent to the NEW number',
    { timeout: 60_000 },
    async () => {
      const phone = indianPhone();
      const { session } = await signIn(phone);
      const token = session.access_token as string;
      const next = indianPhone();
      // Auth allows one SMS per user per 30 s (max_frequency); the sign-in just used it.
      await new Promise((r) => setTimeout(r, 31_000));

      const change = await auth('user', { phone: next }, token, 'PUT');
      expect(change.status).toBe(200);
      const user = await json(
        await fetch(`${SUPABASE}/auth/v1/user`, {
          headers: { apikey: ANON!, authorization: `Bearer ${token}` },
        }),
      );
      expect(user.phone).toBe(phone.slice(1)); // unchanged until verified

      const code = await latestOtp(next);
      expect(code).toMatch(/^\d{6}$/);
      const done = await auth('verify', { type: 'phone_change', phone: next, token: code }, token);
      expect(done.status).toBe(200);
    },
  );

  it('a password set via PUT /user does not open a password sign-in', async () => {
    const phone = indianPhone();
    const { session } = await signIn(phone);
    const password = randomBytes(18).toString('base64url');
    await auth('user', { password }, session.access_token as string, 'PUT');
    const pw = await auth('token?grant_type=password', { phone, password });
    expect(pw.status).toBeGreaterThanOrEqual(400);
  });
});
