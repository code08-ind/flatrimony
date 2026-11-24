/**
 * Is the session behind an access token still alive? (docs/05 §2 item 2.) A JWT stays valid until
 * it expires (up to an hour). Supabase Auth ends a session in two ways, and the check sees both:
 * - signing out (this device or everywhere) deletes its row in `auth.sessions`;
 * - refresh-token reuse (a stolen refresh token used twice) marks all of the session's refresh
 *   tokens revoked and keeps the row, so a session also needs one refresh token that is not
 *   revoked. Sessions on Supabase's newer counter-based refresh tokens have no such rows; for
 *   those, reuse ends the session by deleting the row.
 * A session past `not_after` is over too. (Timebox and inactivity limits, off in
 * supabase/config.toml, are enforced by Auth only at refresh, not here.)
 *
 * Answers are cached per session for SESSION_CACHE_MS, both ways: an active session is checked
 * again at most once a minute; a revoked one never comes back. A failed check is remembered for
 * FAILURE_CACHE_MS so an outage does not send every request to the database, and each check gives
 * up after LOOKUP_TIMEOUT_MS so a stalled database cannot hold requests.
 */
import { sql } from 'kysely';
import type { Database } from '../../lib/db.js';

export const SESSION_CACHE_MS = 60_000;
export const FAILURE_CACHE_MS = 5_000;
export const LOOKUP_TIMEOUT_MS = 2_000;
const MAX_ENTRIES = 50_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the session exists for this user and has not reached its end (`not_after`). */
export type SessionLookup = (sessionId: string, userId: string) => Promise<boolean>;

export function pgSessionLookup(db: Database): SessionLookup {
  return async (sessionId, userId) => {
    if (!UUID.test(sessionId) || !UUID.test(userId)) return false; // never a Supabase session
    const { rows } = await sql<{ ok: number }>`
      select 1 as ok from auth.sessions s
       where s.id = ${sessionId}::uuid
         and s.user_id = ${userId}::uuid
         and (s.not_after is null or s.not_after > now())
         and (s.refresh_token_counter is not null
              or exists (select 1 from auth.refresh_tokens r
                          where r.session_id = s.id and not r.revoked))`.execute(db);
    return rows.length > 0;
  };
}

/**
 * Wraps a lookup with the per-session cache. A lookup that throws is not cached (the database was
 * unreachable: the caller decides), and concurrent checks of one session share one query.
 */
export function cachedSessionLookup(
  lookup: SessionLookup,
  {
    ttlMs = SESSION_CACHE_MS,
    failureMs = FAILURE_CACHE_MS,
    timeoutMs = LOOKUP_TIMEOUT_MS,
    maxEntries = MAX_ENTRIES,
    now = Date.now,
  }: {
    ttlMs?: number;
    failureMs?: number;
    timeoutMs?: number;
    maxEntries?: number;
    now?: () => number;
  } = {},
): SessionLookup {
  const cache = new Map<string, { active: boolean; until: number }>();
  const pending = new Map<string, Promise<boolean>>();
  let failedUntil = 0;
  let lastFailure: unknown = null;
  return async (sessionId, userId) => {
    const key = `${sessionId}:${userId}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.active;
    // The database just failed: answer the same for a few seconds instead of asking again.
    if (failedUntil > now()) throw lastFailure;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('session lookup timed out')), timeoutMs);
    });
    const check = Promise.race([lookup(sessionId, userId), timeout])
      .then((active) => {
        if (cache.size >= maxEntries) {
          // Drop the oldest entry (Map keeps insertion order); refreshed keys move to the end.
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.delete(key);
        cache.set(key, { active, until: now() + ttlMs });
        return active;
      })
      .catch((err: unknown) => {
        failedUntil = now() + failureMs;
        lastFailure = err;
        throw err;
      })
      .finally(() => {
        clearTimeout(timer);
        pending.delete(key);
      });
    pending.set(key, check);
    return check;
  };
}
