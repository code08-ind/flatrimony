import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { buildApp, verifierFromEnv } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createJwtVerifier } from '../src/plugins/auth.js';

const ISSUER = 'https://project.supabase.co/auth/v1';
const USER = '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
// Random per run: no secret-looking literal in the repo (gitleaks), and nothing reusable.
const SECRET = randomBytes(32).toString('hex');

let app: FastifyInstance;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

async function token(
  claims: Record<string, unknown> = {},
  opts: { key?: CryptoKey; exp?: string; iss?: string; aud?: string } = {},
) {
  return new SignJWT({
    role: 'authenticated',
    session_id: 'sess-1',
    amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }],
    ...claims,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(typeof claims.sub === 'string' ? claims.sub : USER)
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '15m')
    .sign(opts.key ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const verifier = createJwtVerifier({ issuer: ISSUER, jwks: createLocalJWKSet({ keys: [jwk] }) });

  app = await buildApp({ env: loadEnv({ NODE_ENV: 'test' }), jwtVerifier: verifier });
  app.get('/test/me', { preHandler: app.requireUser }, async (req) => ({
    id: req.user!.id,
    role: req.user!.appRole,
  }));
  app.get('/test/admin', { preHandler: app.requireRole('moderator', 'admin') }, async () => ({
    ok: true,
  }));
  app.get('/test/public', async (req) => ({ user: req.user?.id ?? null }));
});
afterAll(async () => {
  await app.close();
});

const get = (url: string, auth?: string) =>
  app.inject({ method: 'GET', url, headers: auth ? { authorization: auth } : {} });

describe('auth plugin', () => {
  it('accepts a valid Supabase access token', async () => {
    const res = await get('/test/me', `Bearer ${await token()}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: USER, role: 'user' });
  });

  it('401 with WWW-Authenticate when the token is missing or malformed', async () => {
    for (const auth of [undefined, 'Bearer', 'Basic abc', 'Bearer not-a-jwt']) {
      const res = await get('/test/me', auth);
      expect(res.statusCode, String(auth)).toBe(401);
      expect(res.json().code).toBe('auth.unauthenticated');
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
  });

  it.each([
    ['expired', () => token({}, { exp: '-1m' })],
    ['wrong issuer', () => token({}, { iss: 'https://evil.example/auth/v1' })],
    ['wrong audience', () => token({}, { aud: 'anon' })],
    ['wrong signing key', () => token({}, { key: otherKey })],
    ['anon role', () => token({ role: 'anon' })],
    ['service_role', () => token({ role: 'service_role' })],
    ['non-UUID subject', () => token({ sub: 'user-1' })],
    [
      'password session (amr password)',
      () => token({ amr: [{ method: 'password', timestamp: 1 }] }),
    ],
    ['session without amr', () => token({ amr: undefined })],
  ])('rejects a token with %s', async (_name, make) => {
    const res = await get('/test/me', `Bearer ${await make()}`);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an HS256 token when asymmetric keys are configured (algorithm confusion)', async () => {
    const hs = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(SECRET));
    expect((await get('/test/me', `Bearer ${hs}`)).statusCode).toBe(401);
  });

  it('public routes see the user when a token is sent, null otherwise', async () => {
    expect((await get('/test/public', `Bearer ${await token()}`)).json()).toEqual({ user: USER });
    expect((await get('/test/public')).json()).toEqual({ user: null });
  });

  it('hides admin routes from ordinary users (404) and allows moderators', async () => {
    expect((await get('/test/admin', `Bearer ${await token()}`)).statusCode).toBe(404);
    expect((await get('/test/admin')).statusCode).toBe(401);
    const mod = await token({ app_metadata: { role: 'moderator', provider: 'phone' } });
    expect((await get('/test/admin', `Bearer ${mod}`)).json()).toEqual({ ok: true });
  });
});

describe('verifier configuration', () => {
  it('supports the legacy HS256 secret when no JWKS is configured', async () => {
    const verify = createJwtVerifier({ issuer: ISSUER, secret: SECRET });
    const hs = await new SignJWT({ role: 'authenticated', amr: [{ method: 'otp', timestamp: 1 }] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verify(hs)).resolves.toEqual({ id: USER, appRole: 'user' });
  });

  it('refuses to build without keys, and env decides whether auth is on', () => {
    expect(() => createJwtVerifier({ issuer: ISSUER })).toThrow(/JWKS or a secret/);
    expect(verifierFromEnv(loadEnv({ NODE_ENV: 'test' }))).toBeUndefined();
    expect(
      verifierFromEnv(
        loadEnv({
          NODE_ENV: 'test',
          SUPABASE_JWT_ISSUER: ISSUER,
          SUPABASE_JWKS_URL: `${ISSUER}/.well-known/jwks.json`,
        }),
      ),
    ).toBeTypeOf('function');
  });

  it('requires auth configuration outside local development', () => {
    expect(() => loadEnv({ APP_ENV: 'staging', DATABASE_URL: 'postgres://u:p@h:5432/d' })).toThrow(
      /SUPABASE_JWT_ISSUER/,
    );
    expect(
      loadEnv({
        APP_ENV: 'staging',
        DATABASE_URL: 'postgres://u:p@h:5432/d',
        SUPABASE_JWT_ISSUER: ISSUER,
        SUPABASE_JWT_SECRET: SECRET,
        SEND_SMS_HOOK_SECRETS: `v1,whsec_${randomBytes(32).toString('base64')}`,
        HASH_PEPPER: randomBytes(32).toString('base64'),
      }).APP_ENV,
    ).toBe('staging');
  });

  it('protected routes fail closed when auth is not configured', async () => {
    const bare = await buildApp({ env: loadEnv({ NODE_ENV: 'test' }) });
    bare.get('/test/me', { preHandler: bare.requireUser }, async () => ({ ok: true }));
    const res = await bare.inject({
      method: 'GET',
      url: '/test/me',
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(res.statusCode).toBe(401);
    await bare.close();
  });
});
