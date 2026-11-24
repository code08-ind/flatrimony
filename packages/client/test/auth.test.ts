import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@flatrimony/i18n';
import {
  applyKey,
  displayE164,
  formatNational,
  hasValidStart,
  isValidMobile,
  sanitiseNational,
  toE164,
  formatCountdown,
  secondsLeft,
  codeStillFresh,
  fetchWithTimeout,
  clearsCode,
  requestOtp,
  verifyOtp,
  type AuthClient,
  type AuthError,
  type FlowDeps,
  requestErrorKey,
  verifyErrorKey,
  parseRich,
} from '../src/index.js';

describe('phone entry', () => {
  it('builds the number from keypad keys, capped at 10 digits', () => {
    let v = '';
    for (const k of '981234567899'.split('')) v = applyKey(v, k);
    expect(v).toBe('9812345678');
    expect(applyKey(v, 'backspace')).toBe('981234567');
    expect(applyKey('', 'backspace')).toBe('');
    expect(applyKey('98', 'x')).toBe('98');
  });

  it('flags a first digit that cannot start an Indian mobile at once', () => {
    expect(hasValidStart('')).toBe(true);
    for (const d of '6789') expect(hasValidStart(d)).toBe(true);
    for (const d of '012345') expect(hasValidStart(`${d}98`)).toBe(false);
  });

  it('reuses a fresh code for the same number only (QA T2.4 QA-01)', () => {
    const sent = { phone: '+919812345678', sentAt: 1_000_000 };
    expect(codeStillFresh(sent, '+919812345678', 1_000_000 + 29_000)).toBe(true);
    expect(codeStillFresh(sent, '+919812345678', 1_000_000 + 30_000)).toBe(false);
    expect(codeStillFresh(sent, '+919812345679', 1_000_000 + 1_000)).toBe(false);
    expect(codeStillFresh(null, '+919812345678', 1_000_000)).toBe(false);
  });

  it('sanitises pasted numbers', () => {
    expect(sanitiseNational('+91 98123-45678')).toBe('9812345678');
    expect(sanitiseNational('09812345678')).toBe('9812345678');
    expect(sanitiseNational('98123')).toBe('98123');
  });

  it('formats progressively as 5 + 5', () => {
    expect(formatNational('98123')).toBe('98123');
    expect(formatNational('981234')).toBe('98123 4');
    expect(formatNational('9812345678')).toBe('98123 45678');
    expect(displayE164('+919812345678')).toBe('+91 98123 45678');
  });

  it('accepts Indian mobiles only (10 digits starting 6–9)', () => {
    expect(isValidMobile('9812345678')).toBe(true);
    expect(isValidMobile('6000000000')).toBe(true);
    expect(isValidMobile('5812345678')).toBe(false);
    expect(isValidMobile('981234567')).toBe(false);
    expect(toE164('9812345678')).toBe('+919812345678');
    expect(() => toE164('123')).toThrow();
  });
});

describe('resend countdown', () => {
  it('counts down 30 s and never goes negative', () => {
    expect(secondsLeft(0, 0)).toBe(30);
    expect(secondsLeft(0, 7_200)).toBe(23);
    expect(secondsLeft(0, 30_000)).toBe(0);
    expect(secondsLeft(0, 99_000)).toBe(0);
    expect(formatCountdown(23)).toBe('0:23');
    expect(formatCountdown(75)).toBe('1:15');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

function deps(
  opts: {
    guardStatus?: number;
    guardBody?: unknown;
    guardThrows?: boolean;
    signIn?: AuthError | null;
    signInThrows?: unknown;
  } = {},
) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const signInCalls: string[] = [];
  const auth: AuthClient = {
    async signInWithOtp({ phone }) {
      signInCalls.push(phone);
      if (opts.signInThrows) throw opts.signInThrows;
      return { error: opts.signIn ?? null };
    },
    async verifyOtp() {
      return { error: null };
    },
  };
  const d: FlowDeps = {
    auth,
    apiUrl: 'http://api.test',
    deviceId: 'device-123456',
    appVersion: '0.1.0',
    platform: 'android',
    fetch: async (url, init) => {
      if (opts.guardThrows) throw new TypeError('Network request failed');
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return {
        status: opts.guardStatus ?? 200,
        json: async () => opts.guardBody ?? { allowed: true },
      };
    },
  };
  return { d, calls, signInCalls };
}

describe('requestOtp', () => {
  it('asks otp-guard first, then Supabase, with the E.164 number and device id', async () => {
    const { d, calls, signInCalls } = deps();
    expect(await requestOtp(d, '+919812345678')).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      url: 'http://api.test/v1/auth/otp-guard',
      body: { phone: '+919812345678', deviceId: 'device-123456' },
      headers: { 'x-app-platform': 'android', 'x-app-version': '0.1.0' },
    });
    expect(signInCalls).toEqual(['+919812345678']);
  });

  it('never asks Supabase when the guard refuses', async () => {
    for (const [status, reason] of [
      [403, 'banned'],
      [422, 'invalid_number'],
      [500, 'unavailable'],
    ] as const) {
      const { d, signInCalls } = deps({ guardStatus: status });
      expect(await requestOtp(d, '+919812345678')).toEqual({ ok: false, reason });
      expect(signInCalls).toEqual([]);
    }
  });

  it('passes the guard’s wait time through, with a safe default', async () => {
    expect(
      await requestOtp(
        deps({ guardStatus: 429, guardBody: { retryAfterSeconds: 540 } }).d,
        '+919812345678',
      ),
    ).toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: 540,
    });
    expect(
      await requestOtp(deps({ guardStatus: 429, guardBody: {} }).d, '+919812345678'),
    ).toMatchObject({ retryAfterSeconds: 60 });
  });

  it('maps network and Supabase failures', async () => {
    expect(await requestOtp(deps({ guardThrows: true }).d, '+919812345678')).toEqual({
      ok: false,
      reason: 'network',
    });
    expect(
      await requestOtp(
        deps({ signIn: { status: 429, code: 'over_sms_send_rate_limit' } }).d,
        '+919812345678',
      ),
    ).toEqual({ ok: false, reason: 'resend_too_soon' });
    // Auth's per-IP limits (minutes, shared carrier IPs) are not "wait a few seconds".
    expect(
      await requestOtp(
        deps({ signIn: { status: 429, code: 'over_request_rate_limit' } }).d,
        '+919812345678',
      ),
    ).toEqual({ ok: false, reason: 'too_many_requests' });
    expect(await requestOtp(deps({ signIn: { status: 400 } }).d, '+919812345678')).toEqual({
      ok: false,
      reason: 'invalid_number',
    });
    expect(await requestOtp(deps({ signIn: { status: 500 } }).d, '+919812345678')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(
      await requestOtp(deps({ signIn: { name: 'AuthRetryableFetchError' } }).d, '+919812345678'),
    ).toEqual({ ok: false, reason: 'network' });
    expect(await requestOtp(deps({ signInThrows: new TypeError('x') }).d, '+919812345678')).toEqual(
      { ok: false, reason: 'network' },
    );
    // Our request timeout aborts the fetch.
    const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(await requestOtp(deps({ signInThrows: timeout }).d, '+919812345678')).toEqual({
      ok: false,
      reason: 'network',
    });
  });
});

describe('verifyOtp', () => {
  const auth = (error: AuthError | null, onCall?: () => void): AuthClient => ({
    signInWithOtp: async () => ({ error: null }),
    verifyOtp: async () => {
      onCall?.();
      return { error };
    },
  });

  it('accepts a correct 6-digit code', async () => {
    expect(await verifyOtp({ auth: auth(null) }, '+919812345678', '123456')).toEqual({ ok: true });
  });

  it('does not call Supabase for anything but 6 digits', async () => {
    let called = false;
    expect(
      await verifyOtp({ auth: auth(null, () => (called = true)) }, '+919812345678', '12345'),
    ).toEqual({ ok: false, reason: 'wrong_or_expired_code' });
    expect(called).toBe(false);
  });

  it('maps wrong/expired, rate-limited and network failures', async () => {
    expect(
      await verifyOtp(
        { auth: auth({ status: 403, code: 'otp_expired' }) },
        '+919812345678',
        '000000',
      ),
    ).toEqual({ ok: false, reason: 'wrong_or_expired_code' });
    expect(await verifyOtp({ auth: auth({ status: 429 }) }, '+919812345678', '000000')).toEqual({
      ok: false,
      reason: 'too_many_attempts',
    });
    expect(
      await verifyOtp(
        { auth: auth({ name: 'AuthRetryableFetchError' }) },
        '+919812345678',
        '000000',
      ),
    ).toEqual({ ok: false, reason: 'network' });
    expect(await verifyOtp({ auth: auth({ status: 500 }) }, '+919812345678', '000000')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('keeps the code for a retry only after network or server failures', () => {
    expect(clearsCode('wrong_or_expired_code')).toBe(true);
    expect(clearsCode('too_many_attempts')).toBe(true);
    expect(clearsCode('network')).toBe(false);
    expect(clearsCode('unavailable')).toBe(false);
  });

  it('every failure has a message in English and Hindi', () => {
    const lookup = (locale: 'en' | 'hi', key: string) =>
      key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages[locale]);
    const keys = [
      ...(
        [
          'resend_too_soon',
          'too_many_requests',
          'banned',
          'invalid_number',
          'network',
          'unavailable',
        ] as const
      ).map(requestErrorKey),
      ...(['wrong_or_expired_code', 'too_many_attempts', 'network', 'unavailable'] as const).map(
        verifyErrorKey,
      ),
      'auth.phone.startDigit',
      'auth.errors.rateLimited',
      'auth.errors.notConfigured',
    ];
    for (const key of keys)
      for (const locale of ['en', 'hi'] as const)
        expect(typeof lookup(locale, key), `${locale} ${key}`).toBe('string');
  });
});

describe('rich text', () => {
  it('splits allowed tags and keeps text order', () => {
    expect(
      parseRich('Agree to <terms>Terms</terms> and <privacy>Privacy</privacy>.', [
        'terms',
        'privacy',
      ]),
    ).toEqual([
      { text: 'Agree to ' },
      { tag: 'terms', text: 'Terms' },
      { text: ' and ' },
      { tag: 'privacy', text: 'Privacy' },
      { text: '.' },
    ]);
  });

  it('leaves unknown or unbalanced tags as text', () => {
    expect(parseRich('a <b>x</b>', ['terms'])).toEqual([{ text: 'a <b>x</b>' }]);
    expect(parseRich('a <terms>x', ['terms'])).toEqual([{ text: 'a <terms>x' }]);
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a request that takes too long', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const pending = fetchWithTimeout('https://api.test/x', {}, 1000);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('passes a quick response through', async () => {
    const res = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', async () => res);
    await expect(fetchWithTimeout('https://api.test/x')).resolves.toBe(res);
  });
});
