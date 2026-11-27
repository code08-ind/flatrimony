import { describe, expect, it } from 'vitest';
import { webConfig } from '../lib/server/config';
import {
  API_TIMEOUT_MS,
  FORWARD_TIMEOUT_MS,
  isMediaConfirm,
  MAX_BODY_BYTES,
  MEDIA_API_TIMEOUT_MS,
  MEDIA_FORWARD_TIMEOUT_MS,
  precheck,
  REFRESH_TIMEOUT_MS,
  proxy,
  readCapped,
  type ProxyRequest,
} from '../lib/server/proxy';
import { refreshTokens } from '../lib/server/session';

const NOW = 1_900_000_000_000;
const jwt = (expMs: number) =>
  ['e30', Buffer.from(JSON.stringify({ exp: expMs / 1000 })).toString('base64url'), 'sig'].join(
    '.',
  );
const valid = jwt(NOW + 3_600_000);
const expired = jwt(NOW - 1_000);
const config = webConfig({
  API_URL: 'https://api.test',
  SUPABASE_URL: 'https://auth.test',
  SUPABASE_ANON_KEY: 'anon',
  WEB_PROXY_SECRET: 's'.repeat(40),
  TRUST_PROXY_HOPS: '1',
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** A fake network: Supabase's token endpoint and the API, recording every call. */
function network(opts: {
  refresh?: () => Response | Promise<Response>;
  api?: (auth: string | undefined, call: number) => Response | Promise<Response>;
}) {
  const calls: { url: string; init: RequestInit }[] = [];
  let apiCalls = 0;
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith('https://auth.test')) {
      if (!opts.refresh) throw new Error('unexpected refresh');
      return opts.refresh();
    }
    const auth = (init.headers as Record<string, string>).authorization;
    return opts.api ? opts.api(auth, ++apiCalls) : json(200, { ok: true });
  };
  return {
    calls,
    fetchImpl,
    apiCalls: () => calls.filter((c) => c.url.startsWith('https://api.test')),
  };
}

const request = (over: Partial<ProxyRequest> = {}): ProxyRequest => ({
  method: 'GET',
  path: ['me'],
  search: '',
  headers: new Headers({ host: 'flatrimony.in' }),
  body: undefined,
  access: valid,
  refresh: 'R1',
  ...over,
});

describe('what may pass the proxy at all', () => {
  const headers = (h: Record<string, string>) => new Headers({ host: 'flatrimony.in', ...h });
  it('only the API roots the web app uses, as plain segments', () => {
    for (const ok of [
      ['me'],
      ['me', 'anchor'],
      ['places', 'autocomplete'],
      ['reference'],
      ['config'],
      ['commute', 'preview'],
      ['listings'],
      ['listings', '7d4f3a2e-5b6c-4d7e-8f90-1a2b3c4d5e6f'],
      ['listings', '7d4f3a2e-5b6c-4d7e-8f90-1a2b3c4d5e6f', 'media', 'upload-url'],
      ['me', 'listings'],
      ['verifications', 'email', 'confirm'],
    ])
      expect(precheck('GET', ok, headers({}))).toBeNull();
    for (const bad of [
      [],
      ['auth', 'otp-guard'],
      ['admin', 'reports'],
      ['dev', 'sms-outbox'],
      ['dev', 'email-outbox', 'latest'],
      ['webhooks', 'digilocker'],
      ['internal', 'jobs'],
      ['me', '..'],
      ['me', '.hidden'],
      ['me', 'a%2Fb'],
      ['me', 'a b'],
      ['listings', '..', 'me'],
      ['listings', 'x%2F..%2Fadmin'],
      ['listing'],
    ])
      expect(precheck('GET', bad, headers({}))?.status).toBe(404);
  });
  it('writes only from this site; bodies over the API limit are refused unread', () => {
    expect(precheck('POST', ['me'], headers({}))?.status).toBe(403);
    expect(precheck('PUT', ['me'], headers({ origin: 'https://evil.test' }))?.status).toBe(403);
    expect(precheck('DELETE', ['me'], headers({ origin: 'https://flatrimony.in' }))).toBeNull();
    expect(
      precheck(
        'POST',
        ['me'],
        headers({ origin: 'https://flatrimony.in', 'content-length': String(MAX_BODY_BYTES + 1) }),
      )?.status,
    ).toBe(413);
  });
  it('reads at most the limit from a body that does not declare its length', async () => {
    const stream = (size: number) =>
      new Response(new Uint8Array(size)).body as ReadableStream<Uint8Array>;
    expect((await readCapped(stream(10)))?.byteLength).toBe(10);
    expect(await readCapped(stream(MAX_BODY_BYTES + 1))).toBeNull();
    expect((await readCapped(null))?.byteLength).toBe(0);
  });
});

describe('forwarding', () => {
  it('adds the session and the web client headers, passes the answer through', async () => {
    const net = network({
      api: () =>
        json(200, { id: 'x' }, { etag: 'W/"v3"', 'set-cookie': 'evil=1', 'x-other': 'no' }),
    });
    const result = await proxy(
      request({
        method: 'PUT',
        path: ['me', 'preferences'],
        search: '?a=1',
        body: new TextEncoder().encode('{}').buffer,
        headers: new Headers({
          host: 'flatrimony.in',
          'content-type': 'application/json',
          'if-match': 'W/"v2"',
          'idempotency-key': 'k1',
          cookie: 'fl_at=secret',
          'x-forwarded-for': '6.6.6.6, 203.0.113.7',
        }),
      }),
      config,
      net.fetchImpl,
      () => NOW,
    );
    expect(result.status).toBe(200);
    expect(result.session).toBe('keep');
    expect(result.headers).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json',
      etag: 'W/"v3"',
    });
    const [call] = net.apiCalls();
    expect(call!.url).toBe('https://api.test/v1/me/preferences?a=1');
    expect(call!.init.headers).toEqual({
      'x-app-platform': 'web',
      'x-app-version': '0.1.0',
      'content-type': 'application/json',
      'if-match': 'W/"v2"',
      'idempotency-key': 'k1',
      authorization: `Bearer ${valid}`,
      'x-flatrimony-proxy-secret': 's'.repeat(40),
      'x-flatrimony-client-ip': '203.0.113.7',
    });
  });
  it('no client IP without trusted proxies, no secret without one configured', async () => {
    const net = network({});
    await proxy(
      request({ headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }) }),
      webConfig({ API_URL: 'https://api.test' }),
      net.fetchImpl,
      () => NOW,
    );
    const sent = net.apiCalls()[0]!.init.headers as Record<string, string>;
    expect(sent['x-flatrimony-client-ip']).toBeUndefined();
    expect(sent['x-flatrimony-proxy-secret']).toBeUndefined();
  });
  it('an unreachable API is 502; a bodiless answer stays bodiless', async () => {
    const down = network({ api: () => Promise.reject(new TypeError('offline')) });
    expect((await proxy(request(), config, down.fetchImpl, () => NOW)).status).toBe(502);
    const empty = network({ api: () => new Response(null, { status: 204 }) });
    const result = await proxy(request({ method: 'DELETE' }), config, empty.fetchImpl, () => NOW);
    expect(result).toMatchObject({ status: 204, body: null });
  });
});

describe('the listing editor (T3.9b)', () => {
  it("owner writes pass with this site's Origin; If-Match goes along", async () => {
    const id = '7d4f3a2e-5b6c-4d7e-8f90-1a2b3c4d5e6f';
    const h = new Headers({ host: 'flatrimony.in', origin: 'https://flatrimony.in' });
    for (const [method, path] of [
      ['POST', ['listings']],
      ['PATCH', ['listings', id]],
      ['PUT', ['listings', id, 'costs']],
      ['POST', ['listings', id, 'submit']],
      ['DELETE', ['listings', id, 'media', id]],
    ] as const)
      expect(precheck(method, [...path], h)).toBeNull();
    expect(
      precheck('PATCH', ['listings', id], new Headers({ host: 'flatrimony.in' }))?.status,
    ).toBe(403);
    const net = network({ api: () => json(200, { id }, { etag: 'W/"4"' }) });
    const result = await proxy(
      request({
        method: 'PATCH',
        path: ['listings', id],
        body: new TextEncoder().encode('{"title":"x"}').buffer,
        headers: new Headers({ host: 'flatrimony.in', 'if-match': 'W/"3"' }),
      }),
      config,
      net.fetchImpl,
      () => NOW,
    );
    expect(result.headers.etag).toBe('W/"4"');
    const [call] = net.apiCalls();
    expect(call!.url).toBe(`https://api.test/v1/listings/${id}`);
    expect((call!.init.headers as Record<string, string>)['if-match']).toBe('W/"3"');
  });
  it("only the photo confirm gets the longer budget, and it still fits the browser's", () => {
    expect(isMediaConfirm('POST', ['listings', 'x', 'media'])).toBe(true);
    expect(isMediaConfirm('POST', ['listings', 'x', 'media', 'upload-url'])).toBe(false);
    expect(isMediaConfirm('DELETE', ['listings', 'x', 'media'])).toBe(false);
    expect(isMediaConfirm('POST', ['me', 'x', 'media'])).toBe(false);
    expect(2 * REFRESH_TIMEOUT_MS + 2 * FORWARD_TIMEOUT_MS).toBeLessThan(API_TIMEOUT_MS);
    expect(2 * REFRESH_TIMEOUT_MS + 2 * MEDIA_FORWARD_TIMEOUT_MS).toBeLessThan(
      MEDIA_API_TIMEOUT_MS,
    );
  });
});

describe('the session', () => {
  const rotated = () => json(200, { access_token: valid, refresh_token: 'R2' });

  it('renews an expired access token first and stores the rotated tokens', async () => {
    const net = network({ refresh: rotated });
    const result = await proxy(request({ access: expired }), config, net.fetchImpl, () => NOW);
    expect(result.session).toEqual({ accessToken: valid, refreshToken: 'R2' });
    expect((net.apiCalls()[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${valid}`,
    );
  });
  it('a 401 for a token that looked valid: one refresh, one retry', async () => {
    const net = network({
      refresh: rotated,
      api: (_auth, n) => (n === 1 ? json(401, { code: 'auth.invalid' }) : json(200, {})),
    });
    const result = await proxy(request(), config, net.fetchImpl, () => NOW);
    expect(result.status).toBe(200);
    expect(net.apiCalls()).toHaveLength(2);
    expect(result.session).toMatchObject({ refreshToken: 'R2' });
  });
  it('a refused refresh token ends the session: the cookies are cleared', async () => {
    const net = network({
      refresh: () => json(400, { error_code: 'refresh_token_not_found' }),
      api: () => json(401, {}),
    });
    const result = await proxy(request({ access: expired }), config, net.fetchImpl, () => NOW);
    expect(result).toMatchObject({ status: 401, session: 'clear' });
  });
  it('Supabase down with an expired token: 503 and the cookies kept (not a sign-out)', async () => {
    const net = network({ refresh: () => json(500, {}) });
    const result = await proxy(request({ access: expired }), config, net.fetchImpl, () => NOW);
    expect(result).toMatchObject({ status: 503, session: 'keep' });
    expect(net.apiCalls()).toHaveLength(0);
  });
  it('Supabase down but the token still has a minute: the call goes through', async () => {
    const net = network({ refresh: () => json(500, {}) });
    const soon = jwt(NOW + 30_000);
    const result = await proxy(request({ access: soon }), config, net.fetchImpl, () => NOW);
    expect(result).toMatchObject({ status: 200, session: 'keep' });
  });
  it('a refresh token another request just rotated keeps the session', async () => {
    const res = await refreshTokens(
      { supabaseUrl: 'https://auth.test', supabaseAnonKey: 'anon' },
      'R1',
      async () => json(400, { error_code: 'refresh_token_already_used' }),
    );
    expect(res).toBe('unavailable');
  });
  it('signed out (no cookies): forwarded without a token, nothing to store', async () => {
    const net = network({ api: () => json(401, {}) });
    const result = await proxy(
      request({ access: undefined, refresh: undefined }),
      config,
      net.fetchImpl,
      () => NOW,
    );
    expect(result).toMatchObject({ status: 401, session: 'keep' });
    expect(
      (net.apiCalls()[0]!.init.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });
});
