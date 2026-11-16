import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { OTP_LIMITS, ProblemDetails } from '@flatrimony/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createIdentifierHasher } from '../src/lib/hashing.js';
import { ipKey, memorySlidingWindowStore } from '../src/lib/sliding-window.js';
import { mockSmsProvider, type SmsProvider } from '../src/lib/sms.js';
import { signWebhook } from '../src/lib/standard-webhooks.js';
import { memoryBansRepository, type BansRepository } from '../src/modules/auth/bans.js';
import { BANNED_MESSAGE, waitMessage } from '../src/modules/auth/otp-guard.js';

const PEPPER = randomBytes(32).toString('base64');
const hash = createIdentifierHasher(PEPPER);
// Deliberately NOT on a 15-minute boundary (a fixed-window bug would hide on a boundary).
const START = 1_800_000_000_000 + 7 * 60_000 + 13_000;
const secretB64 = randomBytes(32).toString('base64');
const KEY = Buffer.from(secretB64, 'base64');

let open: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(open.map((a) => a.close()));
  open = [];
});

interface Setup {
  bannedPhones?: string[];
  bannedDevices?: string[];
  bans?: BansRepository;
  provider?: SmsProvider;
  trustProxyHops?: number;
}

async function setup(opts: Setup = {}) {
  let clock = START;
  const logs: string[] = [];
  const outbox = mockSmsProvider({ now: () => clock });
  const app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      HASH_PEPPER: PEPPER,
      SEND_SMS_HOOK_SECRETS: `v1,whsec_${secretB64}`,
      ...(opts.trustProxyHops !== undefined
        ? { TRUST_PROXY_HOPS: String(opts.trustProxyHops) }
        : {}),
    }),
    now: () => clock,
    otpStore: memorySlidingWindowStore(),
    smsProvider: opts.provider ?? outbox,
    bansRepo:
      opts.bans ??
      memoryBansRepository({
        phone: (opts.bannedPhones ?? []).map((p) => hash('phone', p)),
        device: (opts.bannedDevices ?? []).map((d) => hash('device', d)),
      }),
    logStream: { write: (line) => void logs.push(line) },
  });
  open.push(app);
  return { app, outbox, logs, tick: (ms: number) => (clock += ms), now: () => clock };
}

let n = 0;
const phone = () => `+9198${String(10_000_000 + n++)}`;
const device = () => `dev-${randomUUID()}`;
const guard = (
  app: FastifyInstance,
  body: unknown,
  ip = '203.0.113.7',
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/otp-guard',
    payload: body as object,
    remoteAddress: ip,
    headers,
  });

describe('POST /v1/auth/otp-guard: validation', () => {
  it('allows a fresh Indian number and device', async () => {
    const { app } = await setup();
    const res = await guard(app, { phone: phone(), deviceId: device() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ allowed: true });
  });

  it.each([
    ['a non-Indian number', { phone: '+14155550100', deviceId: 'dev-12345678' }],
    ['a number without +91', { phone: '9812345678', deviceId: 'dev-12345678' }],
    ['spaces in the number', { phone: '+91 98123 45678', deviceId: 'dev-12345678' }],
    ['Devanagari digits', { phone: '+९१९८१२३४५६७८', deviceId: 'dev-12345678' }],
    ['a trailing newline', { phone: '+919812345678\n', deviceId: 'dev-12345678' }],
    ['the number as a JSON number', { phone: 919812345678, deviceId: 'dev-12345678' }],
    ['a short device id', { phone: '+919812345678', deviceId: 'x' }],
    ['a 201-character device id', { phone: '+919812345678', deviceId: 'd'.repeat(201) }],
    ['a missing device id', { phone: '+919812345678' }],
  ])('rejects %s with 422 and does not echo the input', async (_n, body) => {
    const { app } = await setup();
    const res = await guard(app, body);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('validation.failed');
    expect(res.body).not.toContain('9812345678');
  });

  it('rejects a non-JSON body with 400', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp-guard',
      payload: '{"phone":',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/auth/otp-guard: limits (sliding windows)', () => {
  it(`allows ${OTP_LIMITS.perPhone.max} per phone in any 15 min, even across a clock boundary`, async () => {
    const { app, tick } = await setup();
    const p = phone();
    for (let i = 0; i < OTP_LIMITS.perPhone.max; i++) {
      expect(
        (await guard(app, { phone: p, deviceId: device() }, `198.51.100.${i}`)).statusCode,
      ).toBe(200);
    }
    // 8 min later, past the next quarter-hour mark: a fixed window would reset here; a sliding one must not.
    tick(8 * 60_000);
    const blocked = await guard(app, { phone: p, deviceId: device() }, '198.51.100.99');
    expect(blocked.statusCode).toBe(429);
    const body = ProblemDetails.parse(blocked.json());
    expect(body.code).toBe('auth.otp_rate_limited');
    expect(body.retryAfterSeconds).toBe(7 * 60); // until the first of the five is 15 min old
    expect(blocked.headers['retry-after']).toBe(String(7 * 60));
    expect(body.detail).toBe('Too many attempts. Try again in 7 minutes.');

    tick(7 * 60_000);
    expect((await guard(app, { phone: p, deviceId: device() }, '198.51.100.100')).statusCode).toBe(
      200,
    );
  });

  it(`allows ${OTP_LIMITS.perDevice.max} per device per hour`, async () => {
    const { app } = await setup();
    const d = device();
    for (let i = 0; i < OTP_LIMITS.perDevice.max; i++) {
      expect(
        (await guard(app, { phone: phone(), deviceId: d }, `198.51.100.${i}`)).statusCode,
      ).toBe(200);
    }
    expect((await guard(app, { phone: phone(), deviceId: d }, '198.51.100.250')).statusCode).toBe(
      429,
    );
  });

  it(`allows ${OTP_LIMITS.perIp.max} per IP per hour; other IPs unaffected`, async () => {
    const { app } = await setup();
    for (let i = 0; i < OTP_LIMITS.perIp.max; i++) {
      expect((await guard(app, { phone: phone(), deviceId: device() })).statusCode).toBe(200);
    }
    const res = await guard(app, { phone: phone(), deviceId: device() });
    expect(res.statusCode).toBe(429);
    expect(res.json().retryAfterSeconds).toBe(60 * 60);
    expect(
      (await guard(app, { phone: phone(), deviceId: device() }, '192.0.2.10')).statusCode,
    ).toBe(200);
  });

  it('a caller over its own IP budget cannot burn a victim number’s quota (no targeted lockout)', async () => {
    const { app } = await setup();
    for (let i = 0; i < OTP_LIMITS.perIp.max; i++)
      await guard(app, { phone: phone(), deviceId: device() });
    const victim = phone();
    for (let i = 0; i < 20; i++)
      expect((await guard(app, { phone: victim, deviceId: device() })).statusCode).toBe(429);
    // The victim's own requests from elsewhere are untouched.
    for (let i = 0; i < OTP_LIMITS.perPhone.max; i++) {
      expect(
        (await guard(app, { phone: victim, deviceId: device() }, `192.0.2.${i}`)).statusCode,
      ).toBe(200);
    }
  });

  it('treats one IPv6 /64 as one client (rotating addresses inside it does not help)', async () => {
    const { app } = await setup();
    for (let i = 0; i < OTP_LIMITS.perIp.max; i++) {
      expect(
        (
          await guard(
            app,
            { phone: phone(), deviceId: device() },
            `2401:4900:1c2a:7f00::${(i + 1).toString(16)}`,
          )
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (await guard(app, { phone: phone(), deviceId: device() }, '2401:4900:1c2a:7f00:abcd::1'))
        .statusCode,
    ).toBe(429);
    expect(
      (await guard(app, { phone: phone(), deviceId: device() }, '2401:4900:1c2a:7f01::1'))
        .statusCode,
    ).toBe(200);
  });

  it('ignores X-Forwarded-For by default, so a client cannot pick its own IP', async () => {
    const { app } = await setup();
    for (let i = 0; i < OTP_LIMITS.perIp.max; i++) {
      await guard(app, { phone: phone(), deviceId: device() }, '203.0.113.7', {
        'x-forwarded-for': `10.9.9.${i}`,
      });
    }
    const res = await guard(app, { phone: phone(), deviceId: device() }, '203.0.113.7', {
      'x-forwarded-for': '10.9.9.250',
    });
    expect(res.statusCode).toBe(429);
  });

  it('trusts exactly the configured proxy hops (Cloud Run: 1)', async () => {
    const { app } = await setup({ trustProxyHops: 1 });
    for (let i = 0; i < OTP_LIMITS.perIp.max; i++) {
      await guard(app, { phone: phone(), deviceId: device() }, '10.0.0.1', {
        'x-forwarded-for': '198.18.0.1',
      });
    }
    expect(
      (
        await guard(app, { phone: phone(), deviceId: device() }, '10.0.0.1', {
          'x-forwarded-for': '198.18.0.1',
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await guard(app, { phone: phone(), deviceId: device() }, '10.0.0.1', {
          'x-forwarded-for': '198.18.0.2',
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('POST /v1/auth/otp-guard: bans', () => {
  it('refuses a banned phone with a neutral 403', async () => {
    const p = phone();
    const { app } = await setup({ bannedPhones: [p] });
    const res = await guard(app, { phone: p, deviceId: device() });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'auth.banned', detail: BANNED_MESSAGE });
  });

  it('refuses a banned device even with a new phone (FR-AUTH-08)', async () => {
    const d = device();
    const { app } = await setup({ bannedDevices: [d] });
    const res = await guard(app, { phone: phone(), deviceId: d });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('auth.banned');
  });

  it('answers 429, not 403, once over a limit: the limits bound ban probing', async () => {
    const p = phone();
    let lookups = 0;
    const bans: BansRepository = {
      async isBanned({ phoneHash }) {
        lookups += 1;
        return !!phoneHash && phoneHash.equals(hash('phone', p));
      },
    };
    const { app } = await setup({ bans });
    for (let i = 0; i < OTP_LIMITS.perIp.max; i++)
      await guard(app, { phone: phone(), deviceId: device() });
    const before = lookups;
    const res = await guard(app, { phone: p, deviceId: device() });
    expect(res.statusCode).toBe(429);
    expect(lookups).toBe(before); // no ban lookup at all when over the limit
  });
});

describe('Send SMS hook: server-side policy (cannot skip otp-guard)', () => {
  function deliver(app: FastifyInstance, to: string, nowMs: number, id = `msg_${randomUUID()}`) {
    const ts = Math.floor(nowMs / 1000);
    const body = JSON.stringify({
      user: { id: randomUUID(), phone: to.slice(1) },
      sms: { otp: '123456', phone: to.slice(1) },
    });
    return app.inject({
      method: 'POST',
      url: '/webhooks/auth/send-sms',
      headers: {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': String(ts),
        'webhook-signature': `v1,${signWebhook(KEY, id, ts, body)}`,
      },
      payload: body,
    });
  }

  it('gives banned and over-limit numbers the same answer, with no retry hint', async () => {
    const banned = phone();
    const busy = phone();
    const { app, outbox, now } = await setup({ bannedPhones: [banned] });
    for (let i = 0; i < OTP_LIMITS.perPhone.max; i++)
      expect((await deliver(app, busy, now())).statusCode).toBe(200);
    const a = await deliver(app, banned, now());
    const b = await deliver(app, busy, now());
    expect(a.statusCode).toBe(403);
    expect(b.statusCode).toBe(403);
    expect(a.json()).toEqual(b.json());
    expect(a.headers['retry-after']).toBeUndefined();
    expect(outbox.sentCount).toBe(OTP_LIMITS.perPhone.max);
  });

  it('counts only successful sends: a failing provider does not use up the number’s quota', async () => {
    let fail = true;
    const sent: string[] = [];
    const flaky: SmsProvider = {
      name: 'flaky',
      async sendOtp({ otp }) {
        if (fail) throw new Error('down');
        sent.push(otp);
      },
    };
    const p = phone();
    const { app, now } = await setup({ provider: flaky });
    for (let i = 0; i < 10; i++) expect((await deliver(app, p, now())).statusCode).toBe(503);
    fail = false;
    for (let i = 0; i < OTP_LIMITS.perPhone.max; i++)
      expect((await deliver(app, p, now())).statusCode).toBe(200);
    expect(sent).toHaveLength(OTP_LIMITS.perPhone.max);
  });

  it('a concurrent duplicate delivery sends once even while the policy check is slow', async () => {
    const p = phone();
    const slowBans: BansRepository = {
      isBanned: () => new Promise((r) => setTimeout(() => r(false), 50)),
    };
    const { app, outbox, now } = await setup({ bans: slowBans });
    const id = `msg_${randomUUID()}`;
    const results = await Promise.all([
      deliver(app, p, now(), id),
      deliver(app, p, now(), id),
      deliver(app, p, now(), id),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 503, 503]);
    expect(outbox.sentCount).toBe(1);
  });

  it('fails closed (500, nothing sent) when the policy check hangs', async () => {
    const hanging: BansRepository = { isBanned: () => new Promise(() => {}) };
    const { app, outbox, now } = await setup({ bans: hanging });
    const res = await deliver(app, phone(), now());
    expect(res.statusCode).toBe(500);
    expect(outbox.sentCount).toBe(0);
  });
});

describe('privacy', () => {
  it('never logs the phone number, device id or their hashes', async () => {
    const p = phone();
    const d = device();
    const { app, logs } = await setup({ bannedPhones: [p] });
    await guard(app, { phone: p, deviceId: d });
    await guard(app, { phone: '+14155550100', deviceId: d });
    const all = logs.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [
      p,
      p.slice(1),
      p.slice(3),
      d,
      hash('phone', p).toString('hex'),
      hash('device', d).toString('hex'),
    ]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe('helpers', () => {
  it('hashes are deterministic, kind-separated and phone-canonical', () => {
    expect(hash('phone', '+919812345678').equals(hash('phone', '919812345678'))).toBe(true);
    expect(hash('device', 'abcdefgh').equals(hash('digilocker', 'abcdefgh'))).toBe(false);
    expect(hash('phone', '+919812345678')).toHaveLength(32);
    expect(() => hash('phone', 'x')).toThrow(/Indian/);
    expect(
      createIdentifierHasher(randomBytes(32).toString('base64'))('device', 'abcdefgh').equals(
        hash('device', 'abcdefgh'),
      ),
    ).toBe(false);
  });

  it('refuses short peppers; the pepper is required outside local', () => {
    expect(() => createIdentifierHasher('short')).toThrow(/32/);
    expect(() =>
      loadEnv({
        APP_ENV: 'staging',
        DATABASE_URL: 'postgres://u:p@h:5432/d',
        SUPABASE_JWT_ISSUER: 'https://x.supabase.co/auth/v1',
        SUPABASE_JWT_SECRET: randomBytes(32).toString('hex'),
        SEND_SMS_HOOK_SECRETS: `v1,whsec_${secretB64}`,
      }),
    ).toThrow(/HASH_PEPPER/);
  });

  it('wait messages read naturally', () => {
    expect(waitMessage(30)).toBe('Too many attempts. Try again in a minute.');
    expect(waitMessage(60)).toBe('Too many attempts. Try again in a minute.');
    expect(waitMessage(61)).toBe('Too many attempts. Try again in 2 minutes.');
  });

  it('keys IPv6 by /64 and IPv4 as is', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('2401:4900:1c2a:7f00::1')).toBe('2401:4900:1c2a:7f00::/64');
    expect(ipKey('2401:4900:1c2a:7f00:1:2:3:4')).toBe('2401:4900:1c2a:7f00::/64');
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
  });

  it('the sliding-window store stays bounded with attacker-chosen keys', () => {
    const store = memorySlidingWindowStore({ maxKeys: 1_000, sweepEvery: 100 });
    const limit = { max: 5, windowMs: 60_000 };
    for (let i = 0; i < 5_000; i++) store.record(`k${i}`, limit, 0);
    expect(store.size).toBeLessThanOrEqual(1_000);
    for (let i = 0; i < 200; i++) store.record(`late${i}`, limit, 120_000); // old keys expired → swept
    expect(store.size).toBeLessThanOrEqual(200 + 100);
  });
});
