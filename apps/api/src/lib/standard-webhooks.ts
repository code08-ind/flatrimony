/**
 * Standard Webhooks verification (https://www.standardwebhooks.com/), as used by Supabase Auth
 * HTTP hooks. Signed content is `${webhook-id}.${webhook-timestamp}.${raw body}`; the signature is
 * base64(HMAC-SHA256(secret, content)). `webhook-signature` may carry several space-separated
 * `v1,<sig>` entries (key rotation). Secrets look like `v1,whsec_<base64>`; several may be
 * configured, separated by `|` or `,` before the next `v1`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookVerdict =
  | { ok: true; id: string; timestamp: number }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'stale' | 'bad_signature' };

export const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

/** Parses a secrets string into raw HMAC keys. Throws on malformed input (fail at startup). */
export function parseWebhookSecrets(raw: string): Buffer[] {
  const parts = raw
    .split(/[|]|,(?=\s*v1,)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('No webhook secrets configured');
  return parts.map((part) => {
    const m = /^v1,whsec_([A-Za-z0-9+/]+={0,2})$/.exec(part);
    if (!m) throw new Error('Webhook secret must look like v1,whsec_<base64>');
    const key = Buffer.from(m[1]!, 'base64');
    // Buffer.from silently drops malformed base64; insist on the canonical form.
    if (key.toString('base64') !== m[1]) throw new Error('Webhook secret is not valid base64');
    if (key.length < 24) throw new Error('Webhook secret is too short (need at least 24 bytes)');
    return key;
  });
}

/** base64(HMAC-SHA256(key, `${id}.${timestamp}.` + body)) over the exact body bytes. */
export function signWebhook(
  key: Buffer,
  id: string,
  timestamp: number,
  body: Buffer | string,
): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest('base64');
}

export function verifyWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer | string,
  keys: readonly Buffer[],
  nowSeconds: number,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): WebhookVerdict {
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sig = headers['webhook-signature'];
  if (typeof id !== 'string' || typeof ts !== 'string' || typeof sig !== 'string' || !id || !sig) {
    return { ok: false, reason: 'missing_headers' };
  }
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
  const timestamp = Number(ts);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale' };

  const offered = sig
    .split(' ')
    .filter((s) => s.startsWith('v1,'))
    .map((s) => Buffer.from(s.slice(3), 'base64'));
  for (const key of keys) {
    const expected = Buffer.from(signWebhook(key, id, timestamp, rawBody), 'base64');
    for (const candidate of offered) {
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
        return { ok: true, id, timestamp };
      }
    }
  }
  return { ok: false, reason: 'bad_signature' };
}
