import { describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '@flatrimony/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { memoryRateLimitStore } from '../src/lib/stores.js';
import type { AuthUser } from '../src/plugins/auth.js';

const USER = '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
const OTHER = '7c1e9a2b-4d3f-4e5a-8b6c-0d1e2f3a4b5c';

// Starts on a 60 s window boundary so Retry-After is the full window.
async function setup(start = 60_000 * 16_666_667, envVars: Record<string, string> = {}) {
  let clock = start;
  const verifier = async (token: string): Promise<AuthUser> => ({
    id: token === 'other.t.t' ? OTHER : USER,
    appRole: 'user',
  });
  const app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', ...envVars }),
    jwtVerifier: verifier,
    rateLimitStore: memoryRateLimitStore(),
    now: () => clock,
  });
  app.post(
    '/test/swipe',
    {
      preHandler: app.requireUser,
      config: { rateLimit: { bucket: 'swipes', limit: 3, windowMs: 60_000 } },
    },
    async () => ({ ok: true }),
  );
  app.get('/test/open', async () => ({ ok: true }));
  app.get('/test/sos', { config: { rateLimit: false } }, async () => ({ ok: true }));
  return { app, tick: (ms: number) => (clock += ms) };
}

const swipe = (app: Awaited<ReturnType<typeof setup>>['app'], token = 'user.t.t') =>
  app.inject({ method: 'POST', url: '/test/swipe', headers: { authorization: `Bearer ${token}` } });

describe('rate limiting', () => {
  it('allows up to the limit, then answers 429 rate_limited with Retry-After', async () => {
    const { app } = await setup();
    for (let i = 1; i <= 3; i++) {
      const res = await swipe(app);
      expect(res.statusCode).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('3');
      expect(res.headers['ratelimit-remaining']).toBe(String(3 - i));
    }
    const blocked = await swipe(app);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });
    expect(blocked.headers['retry-after']).toBe('60');
    await app.close();
  });

  it('resets when the window passes', async () => {
    const { app, tick } = await setup();
    for (let i = 0; i < 4; i++) await swipe(app);
    tick(60_000);
    expect((await swipe(app)).statusCode).toBe(200);
    await app.close();
  });

  it('counts each user separately', async () => {
    const { app } = await setup();
    for (let i = 0; i < 4; i++) await swipe(app);
    expect((await swipe(app)).statusCode).toBe(429);
    expect((await swipe(app, 'other.t.t')).statusCode).toBe(200);
    await app.close();
  });

  it('applies the global per-IP limit to anonymous requests', async () => {
    const { app } = await setup();
    const { limit } = RATE_LIMITS.globalPerIp;
    let last;
    for (let i = 0; i <= limit; i++) last = await app.inject({ method: 'GET', url: '/test/open' });
    expect(last!.statusCode).toBe(429);
    await app.close();
  });

  it('never limits exempt routes (health checks, SOS)', async () => {
    const { app } = await setup();
    for (let i = 0; i <= RATE_LIMITS.globalPerIp.limit + 5; i++)
      await app.inject({ method: 'GET', url: '/test/open' });
    expect((await app.inject({ method: 'GET', url: '/test/sos' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
    await app.close();
  });

  describe('behind the web app (WEB_PROXY_SECRET)', () => {
    const SECRET = 'w'.repeat(40);
    const open = (app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/test/open', headers });
    const exhaust = async (
      app: Awaited<ReturnType<typeof setup>>['app'],
      headers: Record<string, string>,
    ) => {
      for (let i = 0; i < RATE_LIMITS.globalPerIp.limit; i++) await open(app, headers);
    };

    it('counts each forwarded client IP separately when the secret matches', async () => {
      const { app } = await setup(undefined, { WEB_PROXY_SECRET: SECRET });
      const from = (ip: string) => ({
        'x-flatrimony-proxy-secret': SECRET,
        'x-flatrimony-client-ip': ip,
      });
      await exhaust(app, from('203.0.113.7'));
      expect((await open(app, from('203.0.113.7'))).statusCode).toBe(429);
      expect((await open(app, from('198.51.100.20'))).statusCode).toBe(200);
      expect((await open(app, from('2001:db8::1'))).statusCode).toBe(200);
      await app.close();
    });

    it('ignores the forwarded IP without the right secret, or when it is not an IP', async () => {
      // [headers while exhausting the limit, a later request that must still be refused]
      const cases: [Record<string, string>, Record<string, string>][] = [
        [
          { 'x-flatrimony-proxy-secret': 'x'.repeat(40), 'x-flatrimony-client-ip': '203.0.113.7' },
          {
            'x-flatrimony-proxy-secret': 'x'.repeat(40),
            'x-flatrimony-client-ip': '198.51.100.20',
          },
        ],
        [
          { 'x-flatrimony-proxy-secret': SECRET.slice(1), 'x-flatrimony-client-ip': '203.0.113.7' },
          {
            'x-flatrimony-proxy-secret': SECRET.slice(1),
            'x-flatrimony-client-ip': '198.51.100.20',
          },
        ],
        [
          { 'x-flatrimony-proxy-secret': SECRET, 'x-flatrimony-client-ip': 'not-an-ip' },
          { 'x-flatrimony-proxy-secret': SECRET, 'x-flatrimony-client-ip': 'still-not-an-ip' },
        ],
      ];
      for (const [headers, later] of cases) {
        const { app } = await setup(undefined, { WEB_PROXY_SECRET: SECRET });
        await exhaust(app, headers);
        // Everything counted against the socket address: a fresh "client IP" does not help.
        expect((await open(app, later)).statusCode).toBe(429);
        await app.close();
      }
    });

    it('ignores the headers entirely when no secret is configured', async () => {
      const { app } = await setup();
      const headers = {
        'x-flatrimony-proxy-secret': SECRET,
        'x-flatrimony-client-ip': '203.0.113.7',
      };
      await exhaust(app, headers);
      expect(
        (await open(app, { ...headers, 'x-flatrimony-client-ip': '198.51.100.20' })).statusCode,
      ).toBe(429);
      await app.close();
    });

    it('refuses a secret shorter than 32 characters', () => {
      expect(() => loadEnv({ NODE_ENV: 'test', WEB_PROXY_SECRET: 'short' })).toThrow();
    });
  });
});
