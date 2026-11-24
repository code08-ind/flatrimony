import { describe, expect, it, vi } from 'vitest';
import { publicConfig, webConfig } from '../lib/server/config';
import {
  clientIp,
  cookieOptions,
  needsRefresh,
  REFRESH_MARGIN_MS,
  refreshTokens,
  revokeSession,
  sameOrigin,
  tokenExpiry,
} from '../lib/server/session';
import { webAuthClient } from '../lib/client/auth';

const jwt = (payload: object) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const supabase = { supabaseUrl: 'https://auth.test', supabaseAnonKey: 'anon' };

describe('web config', () => {
  it('never hands secrets to the browser', () => {
    const config = webConfig({
      API_URL: 'https://api.test/',
      SUPABASE_URL: 'https://auth.test',
      SUPABASE_ANON_KEY: 'anon',
      WEB_PROXY_SECRET: 's'.repeat(40),
    });
    expect(config.apiUrl).toBe('https://api.test');
    expect(config.proxySecret).toBe('s'.repeat(40));
    expect(JSON.stringify(publicConfig(config))).not.toContain('s'.repeat(40));
    expect(publicConfig(config)).toEqual({
      apiUrl: 'https://api.test',
      supabaseUrl: 'https://auth.test',
      supabaseAnonKey: 'anon',
      appVersion: '0.1.0',
    });
  });
  it('secure cookies unless explicitly local; a short proxy secret is refused', () => {
    expect(webConfig({}).secureCookies).toBe(true);
    expect(webConfig({ APP_ENV: 'staging' }).secureCookies).toBe(true);
    expect(webConfig({ APP_ENV: 'local' }).secureCookies).toBe(false);
    expect(cookieOptions({ secureCookies: true })).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(() => webConfig({ WEB_PROXY_SECRET: 'short' })).toThrow();
  });
  it('trusts 0–5 proxy hops only', () => {
    expect(webConfig({ TRUST_PROXY_HOPS: '1' }).trustProxyHops).toBe(1);
    expect(webConfig({ TRUST_PROXY_HOPS: '-1' }).trustProxyHops).toBe(0);
    expect(webConfig({ TRUST_PROXY_HOPS: 'x' }).trustProxyHops).toBe(0);
  });
});

describe('access token expiry', () => {
  it('reads exp from the JWT; anything unreadable needs a refresh', () => {
    const exp = 2_000_000_000;
    expect(tokenExpiry(jwt({ exp }))).toBe(exp * 1000);
    expect(tokenExpiry('not.a.jwt')).toBeNull();
    expect(tokenExpiry('only-one-part')).toBeNull();
    expect(needsRefresh(undefined, 0)).toBe(true);
    expect(needsRefresh('garbage', 0)).toBe(true);
    const token = jwt({ exp });
    expect(needsRefresh(token, exp * 1000 - REFRESH_MARGIN_MS - 1)).toBe(false);
    expect(needsRefresh(token, exp * 1000 - REFRESH_MARGIN_MS + 1)).toBe(true);
  });
});

describe('refreshing and revoking at Supabase', () => {
  it('trades the refresh token for new tokens', async () => {
    const fetchImpl = vi.fn(async () => json(200, { access_token: 'A2', refresh_token: 'R2' }));
    expect(await refreshTokens(supabase, 'R1', fetchImpl)).toEqual({
      accessToken: 'A2',
      refreshToken: 'R2',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.test/auth/v1/token?grant_type=refresh_token');
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: 'R1' });
    expect((init.headers as Record<string, string>).apikey).toBe('anon');
  });
  it('a refused token ends the session; an outage keeps it', async () => {
    for (const status of [400, 401, 403])
      expect(await refreshTokens(supabase, 'R', async () => json(status, {}))).toBe('invalid');
    expect(await refreshTokens(supabase, 'R', async () => json(500, {}))).toBe('unavailable');
    expect(await refreshTokens(supabase, 'R', async () => json(200, {}))).toBe('unavailable');
    expect(
      await refreshTokens(supabase, 'R', async () => {
        throw new TypeError('offline');
      }),
    ).toBe('unavailable');
    expect(await refreshTokens({ supabaseUrl: '', supabaseAnonKey: '' }, 'R')).toBe('unavailable');
  });
  it('sign-out revokes the session and never throws', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await revokeSession(supabase, 'A', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.test/auth/v1/logout?scope=local');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer A');
    await expect(
      revokeSession(supabase, 'A', async () => {
        throw new TypeError('offline');
      }),
    ).resolves.toBeUndefined();
  });
});

describe('request checks', () => {
  it('client IP: the entry the trusted front end added, never a client-supplied one', () => {
    expect(clientIp('6.6.6.6, 203.0.113.7', 1)).toBe('203.0.113.7');
    expect(clientIp('203.0.113.7, 10.0.0.1', 2)).toBe('203.0.113.7');
    expect(clientIp('2001:db8::1', 1)).toBe('2001:db8::1');
    expect(clientIp('203.0.113.7', 0)).toBeNull(); // no trusted proxy: nothing forwarded
    expect(clientIp(null, 1)).toBeNull();
    expect(clientIp('203.0.113.7', 2)).toBeNull(); // fewer entries than hops
    expect(clientIp('<script>', 1)).toBeNull();
  });
  it('writes only from this site', () => {
    expect(sameOrigin('https://flatrimony.in', 'flatrimony.in')).toBe(true);
    expect(sameOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(sameOrigin('https://evil.test', 'flatrimony.in')).toBe(false);
    expect(sameOrigin('https://flatrimony.in.evil.test', 'flatrimony.in')).toBe(false);
    expect(sameOrigin(null, 'flatrimony.in')).toBe(false);
    expect(sameOrigin('null', 'flatrimony.in')).toBe(false);
  });
});

describe('browser sign-in client', () => {
  it('asks Supabase for an OTP and reports its error code', async () => {
    const fetchImpl = vi.fn(async () =>
      json(429, { code: 429, error_code: 'over_sms_send_rate_limit', msg: 'wait' }),
    );
    const auth = webAuthClient(supabase, fetchImpl);
    expect(await auth.signInWithOtp({ phone: '+919812345678' })).toEqual({
      error: { status: 429, code: 'over_sms_send_rate_limit' },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.test/auth/v1/otp');
    expect(JSON.parse(String(init.body))).toMatchObject({ phone: '+919812345678' });
  });
  it('a verified session goes straight to the server cookie, not into the page', async () => {
    const calls: [string, RequestInit][] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.endsWith('/verify')
        ? json(200, { access_token: 'A', refresh_token: 'R', user: {} })
        : new Response(null, { status: 204 });
    });
    const auth = webAuthClient(supabase, fetchImpl);
    expect(await auth.verifyOtp({ phone: '+919812345678', token: '123456', type: 'sms' })).toEqual({
      error: null,
    });
    expect(calls.map(([u]) => u)).toEqual(['https://auth.test/auth/v1/verify', '/api/session']);
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ accessToken: 'A', refreshToken: 'R' });
  });
  it('wrong code, a session the server refused, or a malformed answer are errors', async () => {
    const wrong = webAuthClient(supabase, async () => json(403, { error_code: 'otp_expired' }));
    expect(await wrong.verifyOtp({ phone: 'p', token: '1', type: 'sms' })).toEqual({
      error: { status: 403, code: 'otp_expired' },
    });
    const refused = webAuthClient(supabase, async (url) =>
      url.endsWith('/verify')
        ? json(200, { access_token: 'A', refresh_token: 'R' })
        : new Response(null, { status: 403 }),
    );
    expect((await refused.verifyOtp({ phone: 'p', token: '1', type: 'sms' })).error).toEqual({
      status: 500,
    });
    const odd = webAuthClient(supabase, async () => json(200, { nope: true }));
    expect((await odd.verifyOtp({ phone: 'p', token: '1', type: 'sms' })).error).toEqual({
      status: 500,
    });
  });
});
