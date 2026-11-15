/**
 * Storage for rate-limit counters and idempotent responses. The shapes mirror
 * private.rate_limits and private.idempotency_keys (docs/04 §6.9), which arrive with
 * migration 0012. Until then the in-memory stores are per instance: good enough for one
 * Cloud Run instance, and Cloudflare rules add an edge limit (docs/03 §14).
 */

export interface RateLimitStore {
  /** Counts one hit in the fixed window containing `now`; returns the new count and window end. */
  hit(bucket: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
}

export interface StoredResponse {
  statusCode: number;
  contentType: string | undefined;
  body: string;
}

export type IdempotencyRecord =
  | { state: 'in_flight'; requestHash: string; createdAt: number }
  | { state: 'done'; requestHash: string; createdAt: number; response: StoredResponse };

export interface IdempotencyStore {
  /** Atomically claims the key; returns the existing record if it is already claimed. */
  begin(scope: string, requestHash: string, now: number): Promise<IdempotencyRecord | null>;
  complete(scope: string, response: StoredResponse): Promise<void>;
  /** Releases a claim so the client can retry (used after 5xx and aborted requests). */
  release(scope: string): Promise<void>;
}

export function memoryRateLimitStore(): RateLimitStore {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(bucket, windowMs, now) {
      const windowStart = now - (now % windowMs);
      const key = `${bucket}@${windowStart}`;
      const entry = windows.get(key) ?? { count: 0, resetAt: windowStart + windowMs };
      entry.count += 1;
      windows.set(key, entry);
      if (windows.size > 10_000) {
        for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
      }
      return { ...entry };
    },
  };
}

export function memoryIdempotencyStore(ttlMs: number): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  return {
    async begin(scope, requestHash, now) {
      const existing = records.get(scope);
      if (existing && now - existing.createdAt < ttlMs) return existing;
      records.set(scope, { state: 'in_flight', requestHash, createdAt: now });
      return null;
    },
    async complete(scope, response) {
      const existing = records.get(scope);
      if (!existing) return;
      records.set(scope, {
        state: 'done',
        requestHash: existing.requestHash,
        createdAt: existing.createdAt,
        response,
      });
    },
    async release(scope) {
      records.delete(scope);
    },
  };
}
