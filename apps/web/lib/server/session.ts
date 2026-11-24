/**
 * The web session (docs/05 §2): Supabase tokens live in HttpOnly, SameSite=Lax cookies that only
 * this server reads. The browser never holds them after sign-in, so page scripts (and anything
 * injected into them) cannot read or exfiltrate a session.
 *
 * Pure helpers with injected fetch, unit-tested without Next.js.
 */
import type { WebConfig } from './config';

export const ACCESS_COOKIE = 'fl_at';
export const REFRESH_COOKIE = 'fl_rt';
/** Supabase refresh tokens do not expire on their own; the cookies are renewed on every refresh. */
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;
/** Refresh this long before the access token expires, so a request never races the expiry. */
export const REFRESH_MARGIN_MS = 60_000;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export function cookieOptions(config: Pick<WebConfig, 'secureCookies'>) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  };
}

/** The access token's expiry (ms), or null when it is not a readable JWT. Not a verification. */
export function tokenExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload || token.split('.').length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when the token is missing, unreadable or expires within the margin. */
export function needsRefresh(token: string | undefined, now: number): boolean {
  if (!token) return true;
  const exp = tokenExpiry(token);
  return exp === null || exp - now < REFRESH_MARGIN_MS;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Trades the refresh token for new tokens (Supabase rotates it). 'invalid': the session is over
 * (revoked, signed out elsewhere); 'unavailable': try again later, keep the cookies. A token that
 * another request of the same page has just rotated ("already used") is 'unavailable' too: that
 * request's answer carries the new cookie, and if Supabase did revoke the session, the next
 * refresh with any of its tokens is refused and ends it then.
 */
export async function refreshTokens(
  config: Pick<WebConfig, 'supabaseUrl' | 'supabaseAnonKey'>,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 4_000,
): Promise<Tokens | 'invalid' | 'unavailable'> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return 'unavailable';
  let res: Response;
  try {
    res = await fetchImpl(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: config.supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return 'unavailable';
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const error = (await res.json().catch(() => null)) as { error_code?: unknown } | null;
    return error?.error_code === 'refresh_token_already_used' ? 'unavailable' : 'invalid';
  }
  if (!res.ok) return 'unavailable';
  const body = (await res.json().catch(() => null)) as {
    access_token?: unknown;
    refresh_token?: unknown;
  } | null;
  return typeof body?.access_token === 'string' && typeof body.refresh_token === 'string'
    ? { accessToken: body.access_token, refreshToken: body.refresh_token }
    : 'unavailable';
}

/** Ends this session at Supabase (its refresh token stops working). Best effort. */
export async function revokeSession(
  config: Pick<WebConfig, 'supabaseUrl' | 'supabaseAnonKey'>,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return;
  await fetchImpl(`${config.supabaseUrl}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

/**
 * The user's IP as this server's trusted front end saw it: the `hops`-th X-Forwarded-For entry
 * from the right (Cloud Run appends the real client address last). Entries further left are
 * client-supplied and ignored. Null without trusted proxies or a usable entry.
 */
export function clientIp(forwardedFor: string | null, hops: number): string | null {
  if (!forwardedFor || hops < 1) return null;
  const entries = forwardedFor.split(',').map((e) => e.trim());
  const entry = entries[entries.length - hops];
  return entry && /^[0-9a-fA-F:.]+$/.test(entry) ? entry : null;
}

/**
 * Cross-site request protection for state-changing calls: the browser's Origin must be this
 * site. SameSite=Lax cookies already stay off cross-site POSTs; this also covers same-site
 * subdomains and old browsers.
 */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
