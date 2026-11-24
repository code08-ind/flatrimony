import { fetchWithTimeout, type AuthClient, type AuthError } from '@flatrimony/client';
import { resetDraft } from './onboarding';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Supabase Auth's error body: `error_code` in current versions, `code` (a string) in some. */
async function authError(res: Response): Promise<AuthError> {
  const body = (await res.json().catch(() => null)) as {
    error_code?: unknown;
    code?: unknown;
  } | null;
  const code =
    typeof body?.error_code === 'string'
      ? body.error_code
      : typeof body?.code === 'string'
        ? body.code
        : undefined;
  return { status: res.status, ...(code ? { code } : {}) };
}

/**
 * The two Supabase Auth calls of the phone sign-in (docs/05 §2), straight from the browser so
 * Supabase applies its per-IP limits to the user. A verified session is handed to this site's
 * server at once (/api/session, HttpOnly cookies); the tokens are not kept in the page.
 */
export function webAuthClient(
  config: { supabaseUrl: string; supabaseAnonKey: string },
  fetchImpl: Fetch = (url, init) => fetchWithTimeout(url, init),
): AuthClient {
  const headers = { apikey: config.supabaseAnonKey, 'content-type': 'application/json' };
  return {
    async signInWithOtp({ phone }) {
      const res = await fetchImpl(`${config.supabaseUrl}/auth/v1/otp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone, create_user: true }),
      });
      return { error: res.ok ? null : await authError(res) };
    },
    async verifyOtp({ phone, token, type }) {
      const res = await fetchImpl(`${config.supabaseUrl}/auth/v1/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone, token, type }),
      });
      if (!res.ok) return { error: await authError(res) };
      const session = (await res.json().catch(() => null)) as {
        access_token?: unknown;
        refresh_token?: unknown;
      } | null;
      if (typeof session?.access_token !== 'string' || typeof session.refresh_token !== 'string')
        return { error: { status: 500 } };
      const stored = await fetchImpl('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        }),
      });
      return { error: stored.ok ? null : { status: 500 } };
    },
  };
}

const DEVICE_KEY = 'flatrimony.install_id';
let cachedDevice: string | undefined;

/**
 * A random id for this browser, for otp-guard's per-device limits and device bans (FR-AUTH-08).
 * Not a fingerprint; clearing site data resets it. The API only stores its HMAC.
 */
export function getDeviceId(): string {
  if (cachedDevice) return cachedDevice;
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return (cachedDevice = existing);
    const id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, id);
    return (cachedDevice = id);
  } catch {
    // Storage blocked (private mode): a per-tab id still lets the guard count this tab.
    return (cachedDevice = crypto.randomUUID());
  }
}

/**
 * Signs out on this site: the server revokes the session and clears its cookies. False when that
 * did not happen (offline, refused): the page must not carry on as if signed out.
 */
export async function signOut(): Promise<boolean> {
  // The unsaved onboarding answers belong to this person: never to whoever signs in next.
  resetDraft();
  try {
    const res = await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
    return res.ok;
  } catch {
    return false;
  }
}
