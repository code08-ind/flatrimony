/**
 * Is the session behind an access token still alive? (docs/05 §2 item 2.) A JWT stays valid until
 * it expires (up to an hour), but signing out, a sign-out everywhere, or a session revoked by
 * Supabase (refresh-token reuse, account deletion) deletes the row in `auth.sessions`. The API
 * checks that row, so a signed-out token stops working within a minute.
 *
 * Answers are cached per session for SESSION_CACHE_MS, both ways: an active session is checked
 * again at most once a minute; a revoked one never comes back.
 */
import { sql } from 'kysely';
import type { Database } from '../../lib/db.js';

export const SESSION_CACHE_MS = 60_000;
const MAX_ENTRIES = 50_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the session exists for this user and has not reached its end (`not_after`). */
export type SessionLookup = (sessionId: string, userId: string) => Promise<boolean>;

export function pgSessionLookup(db: Database): SessionLookup {
  return async (sessionId, userId) => {
    if (!UUID.test(sessionId) || !UUID.test(userId)) return false; // never a Supabase session
    const { rows } = await sql<{ ok: number }>`
      select 1 as ok from auth.sessions
       where id = ${sessionId}::uuid
         and user_id = ${userId}::uuid
         and (not_after is null or not_after > now())`.execute(db);
    return rows.length > 0;
  };
}

/**
 * Wraps a lookup with the per-session cache. A lookup that throws is not cached (the database was
 * unreachable: the caller decides), and concurrent checks of one session share one query.
 */
export function cachedSessionLookup(
  lookup: SessionLookup,
  { ttlMs = SESSION_CACHE_MS, now = Date.now }: { ttlMs?: number; now?: () => number } = {},
): SessionLookup {
  const cache = new Map<string, { active: boolean; until: number }>();
  const pending = new Map<string, Promise<boolean>>();
  return async (sessionId, userId) => {
    const key = `${sessionId}:${userId}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.active;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const check = lookup(sessionId, userId)
      .then((active) => {
        if (cache.size >= MAX_ENTRIES) {
          // Drop the oldest entry (Map keeps insertion order); refreshed keys move to the end.
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.delete(key);
        cache.set(key, { active, until: now() + ttlMs });
        return active;
      })
      .finally(() => pending.delete(key));
    pending.set(key, check);
    return check;
  };
}
