import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createJwtVerifier } from '../src/plugins/auth.js';
import { cachedSessionLookup, type SessionLookup } from '../src/modules/auth/sessions.js';

const ISSUER = 'https://project.supabase.co/auth/v1';
const USER = '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
const SESSION = '0f0e0d0c-0b0a-4908-8706-050403020100';
const SECRET = randomBytes(32).toString('hex');

const token = (claims: Record<string, unknown> = { session_id: SESSION }) =>
  new SignJWT({
    role: 'authenticated',
    amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }],
    ...claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(SECRET));

async function setup(sessionLookup?: SessionLookup) {
  const lines: string[] = [];
  const app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test' }),
    jwtVerifier: createJwtVerifier({ issuer: ISSUER, secret: SECRET }),
    ...(sessionLookup ? { sessionLookup } : {}),
    logStream: { write: (line) => void lines.push(line) },
  });
  app.get('/test/me', { preHandler: app.requireUser }, async (req) => ({ id: req.user!.id }));
  app.get('/test/public', async (req) => ({ user: req.user?.id ?? null }));
  const get = async (url: string, bearer?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });
  return { app, get, lines };
}

describe('signed-out and revoked sessions (docs/05 §2)', () => {
  it('a live session passes; the lookup gets the session and the user', async () => {
    const calls: [string, string][] = [];
    const { app, get } = await setup(async (s, u) => {
      calls.push([s, u]);
      return true;
    });
    expect((await get('/test/me', await token())).statusCode).toBe(200);
    expect(calls).toEqual([[SESSION, USER]]);
    await app.close();
  });

  it('a revoked session is signed out: 401 on protected routes, anonymous on public ones', async () => {
    const { app, get, lines } = await setup(async () => false);
    const t = await token();
    const res = await get('/test/me', t);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('auth.unauthenticated');
    expect((await get('/test/public', t)).json()).toEqual({ user: null });
    expect(lines.join('\n')).toContain('session_revoked');
    expect(lines.join('\n')).not.toContain(t);
    await app.close();
  });

  it('a token without a session id is refused when sessions are checked', async () => {
    const { app, get } = await setup(async () => true);
    expect((await get('/test/me', await token({}))).statusCode).toBe(401);
    await app.close();
  });

  it('an unreachable database is 503 with Retry-After, not a sign-out, on any route', async () => {
    const { app, get } = await setup(async () => {
      throw new Error('connection refused');
    });
    for (const url of ['/test/me', '/test/public']) {
      const res = await get(url, await token());
      expect(res.statusCode, url).toBe(503);
      expect(res.json().code).toBe('upstream.unavailable');
      expect(res.headers['retry-after']).toBe('5');
    }
    // Without a token nothing needs the database.
    expect((await get('/test/public')).statusCode).toBe(200);
    await app.close();
  });

  it('a revoked moderator session loses admin routes too', async () => {
    const { app, get } = await setup(async () => false);
    app.get('/test/admin', { preHandler: app.requireRole('moderator', 'admin') }, async () => ({}));
    const res = await get(
      '/test/admin',
      await token({ session_id: SESSION, app_metadata: { role: 'admin' } }),
    );
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('outside local development the app refuses to run without the check', async () => {
    await expect(
      buildApp({
        env: loadEnv({
          NODE_ENV: 'test',
          APP_ENV: 'staging',
          DATABASE_URL: 'postgres://u:p@h:5432/d',
          SUPABASE_JWT_ISSUER: ISSUER,
          SUPABASE_JWT_SECRET: SECRET,
          HASH_PEPPER: SECRET,
          SUPABASE_URL: 'https://project.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: SECRET,
          FIELD_ENCRYPTION_KEY: `v1:${randomBytes(32).toString('base64')}`,
          DIGILOCKER_WEBHOOK_SECRETS: `v1,whsec_${randomBytes(32).toString('base64')}`,
          PUBLIC_API_URL: 'https://api.staging.test',
          SEND_SMS_HOOK_SECRETS: `v1,whsec_${randomBytes(32).toString('base64')}`,
        }),
      }),
    ).rejects.toThrow(/session revocation check/);
  });

  it('without a lookup (no database, local only) the token alone decides', async () => {
    const { app, get } = await setup();
    expect((await get('/test/me', await token({}))).statusCode).toBe(200);
    await app.close();
  });
});

describe('the session cache', () => {
  it('asks once a minute per session, both for live and revoked ones', async () => {
    let clock = 0;
    const answers = new Map([['live', true]]);
    const calls: string[] = [];
    const lookup = cachedSessionLookup(
      async (s) => {
        calls.push(s);
        return answers.get(s) ?? false;
      },
      { now: () => clock },
    );
    expect(await lookup('live', USER)).toBe(true);
    expect(await lookup('gone', USER)).toBe(false);
    clock += 59_000;
    expect(await lookup('live', USER)).toBe(true);
    expect(await lookup('gone', USER)).toBe(false);
    expect(calls).toEqual(['live', 'gone']);
    // Signed out meanwhile: noticed once the minute is over.
    answers.set('live', false);
    clock += 2_000;
    expect(await lookup('live', USER)).toBe(false);
    expect(calls).toEqual(['live', 'gone', 'live']);
  });

  it('the same session for another user is a different question', async () => {
    const lookup = cachedSessionLookup(async (_s, u) => u === USER);
    expect(await lookup('s', USER)).toBe(true);
    expect(await lookup('s', '00000000-0000-4000-8000-000000000000')).toBe(false);
  });

  it('concurrent checks share one query; a failure is remembered for a few seconds', async () => {
    let clock = 0;
    let calls = 0;
    let fail = true;
    const lookup = cachedSessionLookup(
      async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        if (fail) throw new Error('db down');
        return true;
      },
      { now: () => clock },
    );
    const results = await Promise.allSettled([lookup('s', USER), lookup('s', USER)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(calls).toBe(1);
    fail = false;
    // Within the failure window: the same answer, no new query (an outage is not hammered).
    await expect(lookup('other', USER)).rejects.toThrow('db down');
    expect(calls).toBe(1);
    clock += 5_001;
    expect(await lookup('s', USER)).toBe(true);
    expect(calls).toBe(2);
  });

  it('a stalled database fails the check after the timeout instead of holding requests', async () => {
    const lookup = cachedSessionLookup(() => new Promise<boolean>(() => {}), { timeoutMs: 20 });
    await expect(lookup('s', USER)).rejects.toThrow('timed out');
  });

  it('keeps at most maxEntries sessions, dropping the oldest', async () => {
    const calls: string[] = [];
    const lookup = cachedSessionLookup(
      async (s) => {
        calls.push(s);
        return true;
      },
      { maxEntries: 2 },
    );
    for (const s of ['a', 'b', 'c']) await lookup(s, USER);
    await lookup('c', USER); // cached
    await lookup('a', USER); // dropped when c arrived: asked again
    expect(calls).toEqual(['a', 'b', 'c', 'a']);
  });
});
