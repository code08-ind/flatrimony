import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { mockSmsProvider, type SmsProvider } from '../src/lib/sms.js';
import { parseWebhookSecrets, signWebhook, verifyWebhook } from '../src/lib/standard-webhooks.js';
import { normaliseIndianMobile, sendSmsHookRoutes } from '../src/modules/auth-hooks/routes.js';

// Secrets and ids are generated per run: no secret-looking literals in the repo.
const secretB64 = randomBytes(32).toString('base64');
const SECRETS = `v1,whsec_${secretB64}`;
const KEY = Buffer.from(secretB64, 'base64');
const NOW = 1_800_000_000;
const PHONE = '+919812345678';

let open: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(open.map((a) => a.close()));
  open = [];
});

async function setup(
  opts: { provider?: SmsProvider; appEnv?: 'local' | 'staging'; now?: () => number } = {},
) {
  const outbox = mockSmsProvider({ now: () => (opts.now?.() ?? NOW) * 1000 });
  const env = loadEnv({
    NODE_ENV: 'test',
    SEND_SMS_HOOK_SECRETS: SECRETS,
    ...(opts.appEnv === 'staging'
      ? {
          APP_ENV: 'staging',
          DATABASE_URL: 'postgres://u:p@h:5432/d',
          SUPABASE_JWT_ISSUER: 'https://x.supabase.co/auth/v1',
          SUPABASE_JWT_SECRET: randomBytes(32).toString('hex'),
          HASH_PEPPER: randomBytes(32).toString('base64'),
          SUPABASE_URL: 'https://x.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: randomBytes(24).toString('hex'),
        }
      : {}),
  });
  const app = await buildApp({
    env,
    // Outside local the app needs the session revocation check.
    ...(opts.appEnv === 'staging' ? { sessionLookup: async () => true } : {}),
    smsProvider: opts.provider ?? outbox,
    now: () => (opts.now?.() ?? NOW) * 1000,
  });
  open.push(app);
  return { app, outbox };
}

/** A bare hook instance with tunable options (timeouts, failure caps). */
async function bareHook(
  provider: SmsProvider,
  extra: Partial<Parameters<typeof sendSmsHookRoutes>[1]> = {},
) {
  const app = Fastify();
  await app.register(sendSmsHookRoutes, {
    keys: parseWebhookSecrets(SECRETS),
    provider,
    nowSeconds: () => NOW,
    ...extra,
  });
  open.push(app);
  return app;
}

function payload(phone = PHONE, otp = '561166', extraSms: Record<string, unknown> = {}) {
  return JSON.stringify({
    user: { id: randomUUID(), phone, aud: 'authenticated', role: 'authenticated' },
    sms: { otp, ...extraSms },
  });
}

function signed(body: string, opts: { id?: string; ts?: number; key?: Buffer } = {}) {
  const id = opts.id ?? `msg_${randomUUID()}`;
  const ts = opts.ts ?? NOW;
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': `v1,${signWebhook(opts.key ?? KEY, id, ts, body)}`,
  };
}

const post = (a: FastifyInstance, body: string, headers: Record<string, string>) =>
  a.inject({ method: 'POST', url: '/webhooks/auth/send-sms', headers, payload: body });

describe('signature format (independent of our signer)', () => {
  it('matches the public Standard Webhooks test vector', () => {
    // Published at github.com/standard-webhooks/standard-webhooks; not a real secret.
    const keys = parseWebhookSecrets('v1,whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'); // gitleaks:allow
    const headers = {
      'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'webhook-timestamp': '1614265330',
      'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    };
    expect(verifyWebhook(headers, '{"test": 2432232314}', keys, 1614265330).ok).toBe(true);
    expect(verifyWebhook(headers, '{"test": 2432232315}', keys, 1614265330).ok).toBe(false);
  });

  it('signs "id.timestamp.body" with HMAC-SHA256, base64 (computed with node:crypto directly)', () => {
    const body = payload();
    const expected = createHmac('sha256', KEY).update(`abc.${NOW}.${body}`).digest('base64');
    const headers = {
      'webhook-id': 'abc',
      'webhook-timestamp': String(NOW),
      'webhook-signature': `v1,${expected}`,
    };
    expect(verifyWebhook(headers, body, [KEY], NOW).ok).toBe(true);
  });
});

describe('Send SMS hook', () => {
  it('sends the OTP and answers 200 {} for a correctly signed delivery', async () => {
    const { app, outbox } = await setup();
    const body = payload();
    const res = await post(app, body, signed(body));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
    expect(res.headers['content-type']).toContain('application/json');
    expect(outbox.latest(PHONE, NOW * 1000)).toBe('561166');
  });

  it('accepts the phone without a leading +, and a charset in the content type', async () => {
    const { app, outbox } = await setup();
    const body = payload('919812345678');
    const res = await post(app, body, {
      ...signed(body),
      'content-type': 'application/json; charset=utf-8',
    });
    expect(res.statusCode).toBe(200);
    expect(outbox.latest(PHONE, NOW * 1000)).toBe('561166');
  });

  it('sends to sms.phone (the NEW number during a phone change), not user.phone', async () => {
    const { app, outbox } = await setup();
    const body = payload(PHONE, '123456', { phone: '919900000000' });
    expect((await post(app, body, signed(body))).statusCode).toBe(200);
    expect(outbox.latest('+919900000000', NOW * 1000)).toBe('123456');
    expect(outbox.latest(PHONE, NOW * 1000)).toBeUndefined();
  });

  it.each([
    ['missing signature headers', (_b: string) => ({ 'content-type': 'application/json' })],
    ['wrong key', (b: string) => signed(b, { key: randomBytes(32) })],
    ['timestamp 301 s old', (b: string) => signed(b, { ts: NOW - 301 })],
    ['timestamp 301 s ahead', (b: string) => signed(b, { ts: NOW + 301 })],
  ])('rejects %s with 401 in the hook error format and sends nothing', async (_n, headers) => {
    const { app, outbox } = await setup();
    const body = payload();
    const res = await post(app, body, headers(body));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { http_code: 401, message: 'Invalid webhook signature' } });
    expect(outbox.sentCount).toBe(0);
  });

  it('accepts timestamps exactly 300 s old or ahead', async () => {
    const { app } = await setup();
    for (const ts of [NOW - 300, NOW + 300]) {
      const body = payload();
      expect((await post(app, body, signed(body, { ts }))).statusCode).toBe(200);
    }
  });

  it('binds the signature to the body, the webhook-id and the timestamp', async () => {
    const { app } = await setup();
    const body = payload();
    const headers = signed(body);
    expect((await post(app, body.replace('561166', '000000'), headers)).statusCode).toBe(401);
    expect((await post(app, body, { ...headers, 'webhook-id': 'msg_other' })).statusCode).toBe(401);
    expect(
      (await post(app, body, { ...headers, 'webhook-timestamp': String(NOW - 1) })).statusCode,
    ).toBe(401);
  });

  it('accepts deliveries signed with any configured key (secret rotation)', async () => {
    const second = randomBytes(32);
    const app = Fastify();
    await app.register(sendSmsHookRoutes, {
      keys: parseWebhookSecrets(`${SECRETS}|v1,whsec_${second.toString('base64')}`),
      provider: mockSmsProvider(),
      nowSeconds: () => NOW,
    });
    open.push(app);
    const body = payload();
    expect((await post(app, body, signed(body, { key: second }))).statusCode).toBe(200);
  });

  it('does not send twice for a replayed delivery (same webhook-id)', async () => {
    const { app, outbox } = await setup();
    const body = payload();
    const headers = signed(body);
    expect((await post(app, body, headers)).statusCode).toBe(200);
    expect((await post(app, body, headers)).statusCode).toBe(200);
    expect(outbox.sentCount).toBe(1);
  });

  it('forgets delivery ids after the replay window', async () => {
    let now = NOW;
    const { app, outbox } = await setup({ now: () => now });
    const body = payload();
    const headers = signed(body, { ts: NOW });
    await post(app, body, headers);
    now = NOW + 601; // outside the 600 s window; the old timestamp is then also stale
    expect((await post(app, body, headers)).statusCode).toBe(401);
    expect(outbox.sentCount).toBe(1);
  });

  it('answers 503 + retry-after to a concurrent duplicate while the first send is in flight', async () => {
    let release!: () => void;
    const slow: SmsProvider = {
      name: 'slow',
      sendOtp: () => new Promise<void>((r) => (release = r)),
    };
    const app = await bareHook(slow, { providerTimeoutMs: 5_000 });
    const body = payload();
    const headers = signed(body);
    const first = post(app, body, headers);
    await new Promise((r) => setTimeout(r, 20));
    const dup = await post(app, body, headers);
    expect(dup.statusCode).toBe(503);
    expect(dup.headers['retry-after']).toBe('1');
    release();
    expect((await first).statusCode).toBe(200);
  });

  it('refuses non-Indian numbers', async () => {
    const { app } = await setup();
    const body = payload('+14155550100');
    const res = await post(app, body, signed(body));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Indian/);
  });

  it('refuses malformed payloads', async () => {
    const { app } = await setup();
    for (const body of [
      '{"user":{}}',
      'not json',
      JSON.stringify({ user: { id: randomUUID(), phone: PHONE }, sms: { otp: '12' } }),
    ]) {
      expect((await post(app, body, signed(body))).statusCode).toBe(400);
    }
  });

  it('asks Auth to retry (503 + retry-after: 1) when the provider fails, and lets the retry send', async () => {
    let fail = true;
    const sent: string[] = [];
    const flaky: SmsProvider = {
      name: 'flaky',
      async sendOtp({ otp }) {
        if (fail) throw new Error(`gateway refused ${PHONE}`); // message must never be logged
        sent.push(otp);
      },
    };
    const { app } = await setup({ provider: flaky });
    const body = payload();
    const headers = signed(body);
    const res = await post(app, body, headers);
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.json()).toEqual({ error: { http_code: 503, message: 'SMS provider unavailable' } });
    fail = false;
    expect((await post(app, body, headers)).statusCode).toBe(200);
    expect(sent).toEqual(['561166']);
  });

  it('aborts a hanging provider within the hook budget', async () => {
    let aborted = false;
    const hanging: SmsProvider = {
      name: 'hanging',
      sendOtp: (_m, signal) =>
        new Promise((_r, reject) =>
          signal?.addEventListener('abort', () => ((aborted = true), reject(new Error('aborted')))),
        ),
    };
    const app = await bareHook(hanging, { providerTimeoutMs: 50 });
    const body = payload();
    const res = await post(app, body, signed(body));
    expect(res.statusCode).toBe(503);
    expect(aborted).toBe(true);
  });

  it('caps failed signature checks per IP (429 without further verification)', async () => {
    const app = await bareHook(mockSmsProvider(), { maxFailuresPerMinute: 3 });
    const body = payload();
    for (let i = 0; i < 3; i++)
      expect((await post(app, body, signed(body, { key: randomBytes(32) }))).statusCode).toBe(401);
    expect((await post(app, body, signed(body, { key: randomBytes(32) }))).statusCode).toBe(429);
  });

  it('is not subject to the per-IP request limit (all OTPs arrive from the Auth server)', async () => {
    const { app } = await setup();
    const results = [];
    for (let i = 0; i < 305; i++) {
      // Different numbers: the per-phone OTP limit (T2.3) is a separate, intended cap.
      const body = payload(`+9198${String(10_000_000 + i)}`);
      results.push((await post(app, body, signed(body))).statusCode);
    }
    expect(results.every((s) => s === 200)).toBe(true);
  });

  it('is not registered when no secret is configured', async () => {
    const app = await buildApp({ env: loadEnv({ NODE_ENV: 'test' }) });
    open.push(app);
    const body = payload();
    expect((await post(app, body, signed(body))).statusCode).toBe(404);
  });

  it.each([
    ['text/plain', 'text/plain'],
    ['form', 'application/x-www-form-urlencoded'],
    ['xml', 'application/xml'],
  ])(
    'refuses a correctly signed %s body with 415 in the hook format and sends nothing',
    async (_n, type) => {
      const { app, outbox } = await setup();
      const body = payload();
      const res = await post(app, body, { ...signed(body), 'content-type': type });
      expect(res.statusCode).toBe(415);
      expect(res.json()).toEqual({
        error: { http_code: 415, message: 'Content-Type must be application/json' },
      });
      expect(outbox.sentCount).toBe(0);
    },
  );

  it('caps every body at 20 KB, answering in the hook format', async () => {
    const { app } = await setup();
    const big = JSON.stringify({ pad: 'x'.repeat(30 * 1024) });
    for (const type of ['application/json', 'text/plain']) {
      const res = await post(app, big, { ...signed(big), 'content-type': type });
      expect(res.statusCode, type).toBe(413);
      expect(res.json()).toEqual({ error: { http_code: 413, message: 'Payload too large' } });
    }
  });

  it('a POST to the hook without a content type is a 415 in the hook format, not a 500', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/auth/send-sms',
      payload: 'x',
      headers: { 'content-type': '' },
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({
      error: { http_code: 415, message: 'Content-Type must be application/json' },
    });
  });
});

describe('dev SMS outbox', () => {
  it('returns the latest mock OTP locally, by phone in the body', async () => {
    const { app } = await setup();
    const body = payload();
    await post(app, body, signed(body));
    const res = await app.inject({
      method: 'POST',
      url: '/dev/sms-outbox/latest',
      payload: { phone: PHONE },
    });
    expect(res.json()).toEqual({ otp: '561166' });
    const none = await app.inject({
      method: 'POST',
      url: '/dev/sms-outbox/latest',
      payload: { phone: '+919800000000' },
    });
    expect(none.statusCode).toBe(404);
  });

  it('answers only loopback connections', async () => {
    const { app } = await setup();
    const body = payload();
    await post(app, body, signed(body));
    const lan = await app.inject({
      method: 'POST',
      url: '/dev/sms-outbox/latest',
      payload: { phone: PHONE },
      remoteAddress: '192.168.1.20',
    });
    expect(lan.statusCode).toBe(404);
  });

  it('expires OTPs after the TTL', () => {
    let t = 0;
    const box = mockSmsProvider({ ttlMs: 1_000, now: () => t });
    void box.sendOtp({ phone: PHONE, otp: '111111' });
    expect(box.latest(PHONE)).toBe('111111');
    t = 1_001;
    expect(box.latest(PHONE)).toBeUndefined();
  });

  it('does not exist outside local', async () => {
    const { app } = await setup({ appEnv: 'staging' });
    const res = await app.inject({
      method: 'POST',
      url: '/dev/sms-outbox/latest',
      payload: { phone: PHONE },
    });
    expect(res.statusCode).toBe(404);
  });

  it('the mock provider is refused in production', () => {
    expect(() =>
      loadEnv({
        APP_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@h:5432/d',
        SUPABASE_JWT_ISSUER: 'https://x.supabase.co/auth/v1',
        SUPABASE_JWT_SECRET: randomBytes(32).toString('hex'),
        SEND_SMS_HOOK_SECRETS: SECRETS,
      }),
    ).toThrow(/mock is not allowed in production/);
  });
});

describe('standard webhooks helpers', () => {
  it('parses one or several secrets and rejects malformed ones', () => {
    const other = randomBytes(32).toString('base64');
    expect(parseWebhookSecrets(SECRETS)).toHaveLength(1);
    expect(parseWebhookSecrets(` ${SECRETS} `)).toHaveLength(1);
    expect(parseWebhookSecrets(`${SECRETS}|v1,whsec_${other}`)).toHaveLength(2);
    expect(parseWebhookSecrets(`${SECRETS},v1,whsec_${other}`)).toHaveLength(2);
    expect(parseWebhookSecrets(`${SECRETS}|`)).toHaveLength(1);
    expect(() => parseWebhookSecrets('')).toThrow();
    expect(() => parseWebhookSecrets('whsec_abc')).toThrow(/v1,whsec_/);
    expect(() => parseWebhookSecrets(`v1,whsec_${randomBytes(8).toString('base64')}`)).toThrow(
      /too short/,
    );
    expect(() => parseWebhookSecrets(`v1,whsec_${secretB64.slice(0, -2)}A`)).toThrow();
  });

  it('rejects malformed hook secrets at startup with the other env errors', () => {
    expect(() => loadEnv({ SEND_SMS_HOOK_SECRETS: 'not-a-secret' })).toThrow(
      /SEND_SMS_HOOK_SECRETS/,
    );
  });

  it('accepts any of several offered signatures and rejects non-numeric timestamps', () => {
    const body = '{}';
    const good = signWebhook(KEY, 'id1', NOW, body);
    const headers = {
      'webhook-id': 'id1',
      'webhook-timestamp': String(NOW),
      'webhook-signature': `v1,AAAA v1,${good}`,
    };
    expect(verifyWebhook(headers, body, [KEY], NOW)).toEqual({
      ok: true,
      id: 'id1',
      timestamp: NOW,
    });
    expect(verifyWebhook({ ...headers, 'webhook-timestamp': 'abc' }, body, [KEY], NOW)).toEqual({
      ok: false,
      reason: 'bad_timestamp',
    });
  });

  it('accepts only Indian mobile numbers', () => {
    expect(normaliseIndianMobile('+919812345678')).toBe('+919812345678');
    expect(normaliseIndianMobile('919812345678')).toBe('+919812345678');
    expect(normaliseIndianMobile('+915812345678')).toBeNull();
    expect(normaliseIndianMobile('+9198123456789')).toBeNull();
  });
});
