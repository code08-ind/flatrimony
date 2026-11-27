/**
 * The browser's way to the API (docs/05 §2) as a pure function, unit-tested without Next.js:
 * /api/v1/<path> → API_URL/v1/<path> with the user's access token from the HttpOnly cookie. The
 * token is refreshed shortly before it expires (and once more after a 401); the rotated tokens go
 * back into the cookies. Nothing here is logged.
 */
import { WEB_APP_VERSION, type WebConfig } from './config';
import {
  clientIp,
  needsRefresh,
  refreshTokens,
  sameOrigin,
  tokenExpiry,
  type Tokens,
} from './session';

/** The API's own body limit (Fastify default): anything larger is refused before it is read. */
export const MAX_BODY_BYTES = 100 * 1024;

/** Only what the web app uses (listings: the web listing editor, T3.9b; verifications: the work/college email link page, T3.3); auth hooks, otp-guard (the browser calls it itself), dev routes and admin stay out of reach. */
export const ALLOWED_ROOTS = new Set([
  'me',
  'config',
  'reference',
  'places',
  'commute',
  'listings',
  'verifications',
]);

const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const PASS_REQUEST = [
  'accept-language',
  'content-type',
  'if-match',
  'idempotency-key',
  'x-request-id',
] as const;
const PASS_RESPONSE = [
  'content-type',
  'etag',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'idempotent-replayed',
  'x-request-id',
] as const;
/** Statuses that must not carry a body. */
const NO_BODY = new Set([204, 205, 304]);

/**
 * Time budgets: two refreshes and two forwards stay under the browser's limit for /api/v1
 * (API_TIMEOUT_MS), so a rotated refresh token is never thrown away by a browser that gave up.
 */
export const REFRESH_TIMEOUT_MS = 4_000;
export const FORWARD_TIMEOUT_MS = 10_000;
export const API_TIMEOUT_MS = 30_000;
/**
 * Confirming a listing photo (POST /listings/{id}/media) re-encodes it on the API, which takes
 * longer than an ordinary call on a busy server: its own budget, and the browser waits
 * MEDIA_API_TIMEOUT_MS (two refreshes and two forwards still fit).
 */
export const MEDIA_FORWARD_TIMEOUT_MS = 40_000;
export const MEDIA_API_TIMEOUT_MS = 90_000;

/** POST /listings/{id}/media: the one call that gets the longer budget. */
export const isMediaConfirm = (method: string, path: string[]) =>
  method === 'POST' && path.length === 3 && path[0] === 'listings' && path[2] === 'media';

export interface ProxyRequest {
  method: string;
  path: string[];
  search: string;
  headers: Headers;
  body: ArrayBuffer | undefined;
  access: string | undefined;
  refresh: string | undefined;
}

export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer | string | null;
  /** keep the cookies, replace them with rotated tokens, or clear them (the session is over) */
  session: 'keep' | 'clear' | Tokens;
}

export const problem = (status: number, code: string, title: string): ProxyResult => ({
  status,
  headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
  body: JSON.stringify({ type: `https://docs.flatrimony.in/errors/${code}`, title, status, code }),
  session: 'keep',
});

/** Checks done before the body is read: the path, and the Origin of writes. */
export function precheck(method: string, path: string[], headers: Headers): ProxyResult | null {
  // Plain path segments under an allowed root: no "..", no encoded slashes, nothing else.
  if (!path.length || !ALLOWED_ROOTS.has(path[0]!) || !path.every((s) => SEGMENT.test(s)))
    return problem(404, 'not_found', 'Not found');
  if (method !== 'GET' && !sameOrigin(headers.get('origin'), headers.get('host')))
    return problem(403, 'forbidden', 'Forbidden');
  const length = Number(headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return problem(413, 'payload_too_large', 'Request too large');
  return null;
}

/** Reads at most `max` bytes; null when the body is larger. */
export async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  max = MAX_BODY_BYTES,
): Promise<ArrayBuffer | null> {
  if (!stream) return new ArrayBuffer(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function proxy(
  req: ProxyRequest,
  config: WebConfig,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<ProxyResult> {
  let access = req.access;
  let rotated: Tokens | null = null;
  let ended = false;
  let authDown = false;

  const renew = async () => {
    if (!req.refresh || ended) return;
    const result = await refreshTokens(
      config,
      rotated?.refreshToken ?? req.refresh,
      fetchImpl,
      REFRESH_TIMEOUT_MS,
    );
    if (result === 'invalid') {
      ended = true;
      access = undefined;
    } else if (result === 'unavailable') authDown = true;
    else {
      rotated = result;
      access = result.accessToken;
    }
  };
  if (req.refresh && needsRefresh(access, now())) await renew();

  // Supabase Auth could not renew a token that has already expired: say so (503) rather than
  // send it and get a 401, which the page would read as "signed out".
  const exp = access ? tokenExpiry(access) : null;
  if (authDown && !rotated && (exp === null || exp <= now()))
    return problem(503, 'auth.unavailable', 'Sign-in is not available right now');

  const target = `${config.apiUrl}/v1/${req.path.join('/')}${req.search}`;
  const ip = clientIp(req.headers.get('x-forwarded-for'), config.trustProxyHops);
  const send = () => {
    const out: Record<string, string> = {
      'x-app-platform': 'web',
      'x-app-version': WEB_APP_VERSION,
    };
    for (const name of PASS_REQUEST) {
      const value = req.headers.get(name);
      if (value) out[name] = value;
    }
    if (access) out.authorization = `Bearer ${access}`;
    if (config.proxySecret && ip) {
      out['x-flatrimony-proxy-secret'] = config.proxySecret;
      out['x-flatrimony-client-ip'] = ip;
    }
    return fetchImpl(target, {
      method: req.method,
      headers: out,
      ...(req.body !== undefined ? { body: req.body } : {}),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(
        isMediaConfirm(req.method, req.path) ? MEDIA_FORWARD_TIMEOUT_MS : FORWARD_TIMEOUT_MS,
      ),
    });
  };

  let res: Response;
  let body: ArrayBuffer | null;
  try {
    res = await send();
    // An access token revoked or expired early: one refresh and one retry.
    if (res.status === 401 && req.refresh && !rotated && !ended) {
      await renew();
      if (rotated) res = await send();
    }
    body = NO_BODY.has(res.status) ? null : await res.arrayBuffer();
  } catch {
    return {
      ...problem(502, 'upstream.unavailable', 'The service is not reachable'),
      session: rotated ?? (ended ? 'clear' : 'keep'),
    };
  }

  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  for (const name of PASS_RESPONSE) {
    const value = res.headers.get(name);
    if (value) headers[name] = value;
  }
  return {
    status: res.status,
    headers,
    body,
    session: rotated ?? (ended ? 'clear' : 'keep'),
  };
}
