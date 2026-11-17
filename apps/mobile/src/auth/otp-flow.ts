/**
 * Phone OTP sign-in flow (FR-AUTH-01/02/08; docs/05 §2). Pure orchestration with injected
 * dependencies so it is unit-tested without React Native, Supabase or the network.
 *
 *   requestOtp: POST /v1/auth/otp-guard  →  supabase.auth.signInWithOtp({ phone })
 *   verifyOtp:  supabase.auth.verifyOtp({ phone, token, type: 'sms' })
 *
 * Results are typed outcomes the screens map to translated messages; raw server text is never
 * shown (it is English-only and may change).
 */

export type RequestOtpResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; reason: 'resend_too_soon' }
  | { ok: false; reason: 'too_many_requests' }
  | { ok: false; reason: 'banned' }
  | { ok: false; reason: 'invalid_number' }
  | { ok: false; reason: 'network' }
  | { ok: false; reason: 'unavailable' };

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: 'wrong_or_expired_code' }
  | { ok: false; reason: 'too_many_attempts' }
  | { ok: false; reason: 'network' }
  | { ok: false; reason: 'unavailable' };

/** The subset of supabase-js we use; its errors carry `status` and `code`. */
export interface AuthClient {
  signInWithOtp(args: { phone: string }): Promise<{ error: AuthError | null }>;
  verifyOtp(args: {
    phone: string;
    token: string;
    type: 'sms';
  }): Promise<{ error: AuthError | null }>;
}
export interface AuthError {
  status?: number;
  code?: string;
  name?: string;
}

export interface FlowDeps {
  auth: AuthClient;
  /** fetch-compatible */
  fetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{
    status: number;
    json(): Promise<unknown>;
  }>;
  apiUrl: string;
  deviceId: string;
  appVersion: string;
  platform: 'android' | 'ios' | 'web';
}

const NETWORK_ERROR_NAMES = new Set(['AuthRetryableFetchError', 'AbortError', 'TimeoutError']);

/** No connection, DNS failure or our request timeout (fetchWithTimeout aborts). */
function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    NETWORK_ERROR_NAMES.has((err as { name?: string } | null)?.name ?? '')
  );
}

/**
 * Whether a failed verification should empty the code boxes. A wrong or used-up code is cleared
 * (the user needs a new one); after a network or server failure the code is kept, so "Verify"
 * can simply be tapped again without finding the SMS once more.
 */
export function clearsCode(reason: Exclude<VerifyOtpResult, { ok: true }>['reason']): boolean {
  return reason === 'wrong_or_expired_code' || reason === 'too_many_attempts';
}

export async function requestOtp(deps: FlowDeps, phoneE164: string): Promise<RequestOtpResult> {
  // 1. Our guard: bans and per phone/device/IP limits (advisory; the hook enforces server-side).
  let guard;
  try {
    guard = await deps.fetch(`${deps.apiUrl}/v1/auth/otp-guard`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-app-platform': deps.platform,
        'x-app-version': deps.appVersion,
      },
      body: JSON.stringify({ phone: phoneE164, deviceId: deps.deviceId }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (guard.status === 429) {
    const body = (await guard.json().catch(() => ({}))) as { retryAfterSeconds?: unknown };
    const wait =
      typeof body.retryAfterSeconds === 'number' && body.retryAfterSeconds > 0
        ? body.retryAfterSeconds
        : 60;
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: wait };
  }
  if (guard.status === 403) return { ok: false, reason: 'banned' };
  if (guard.status === 422) return { ok: false, reason: 'invalid_number' };
  if (guard.status !== 200) return { ok: false, reason: 'unavailable' };

  // 2. Supabase Auth sends the OTP through our Send SMS hook.
  try {
    const { error } = await deps.auth.signInWithOtp({ phone: phoneE164 });
    if (!error) return { ok: true };
    // The 30 s per-number interval (auth.sms.max_frequency) vs Auth's own per-IP request limits,
    // which can last minutes (many users share one carrier IP).
    if (error.code === 'over_sms_send_rate_limit') return { ok: false, reason: 'resend_too_soon' };
    if (error.status === 429) return { ok: false, reason: 'too_many_requests' };
    if (error.status === 400) return { ok: false, reason: 'invalid_number' };
    if (isNetworkError(error)) return { ok: false, reason: 'network' };
    return { ok: false, reason: 'unavailable' };
  } catch (err) {
    return { ok: false, reason: isNetworkError(err) ? 'network' : 'unavailable' };
  }
}

export async function verifyOtp(
  deps: Pick<FlowDeps, 'auth'>,
  phoneE164: string,
  code: string,
): Promise<VerifyOtpResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'wrong_or_expired_code' };
  try {
    const { error } = await deps.auth.verifyOtp({ phone: phoneE164, token: code, type: 'sms' });
    if (!error) return { ok: true };
    if (error.status === 429) return { ok: false, reason: 'too_many_attempts' };
    if (error.status === 401 || error.status === 403 || error.code === 'otp_expired') {
      return { ok: false, reason: 'wrong_or_expired_code' };
    }
    if (isNetworkError(error)) return { ok: false, reason: 'network' };
    return { ok: false, reason: 'unavailable' };
  } catch (err) {
    return { ok: false, reason: isNetworkError(err) ? 'network' : 'unavailable' };
  }
}
