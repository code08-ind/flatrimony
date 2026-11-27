/**
 * Listing expiry and reminders (T3.10; FR-LST-07; docs/04 §11): on every tick (5 minutes).
 *
 * - **Reminder:** a live listing whose 7 days end within the next day gets one in-app notification
 *   ("Is your room still available?", deep link to My Flat) for that expiry: the reminder records
 *   which `expires_at` it was for. Confirming (the one-tap "Still available") moves `expires_at` 7
 *   days ahead, so the next reminder is due a week later; no clocks of two transactions are compared.
 *   After a worker outage of over a day, a listing may get its reminder and its expiry in one tick.
 * - **Expiry:** a live listing past `expires_at` becomes `expired` (out of discovery). One tap on
 *   "Still available" (or Resume) brings it back, after the automatic checks (T3.8).
 *
 * Both are set-based, batched, and safe to run twice at once (row locks with SKIP LOCKED; the
 * reminder is marked in the same statement that finds it). Push delivery reads the notification
 * rows later (Blocked on the Expo/FCM project).
 */
import { sql } from 'kysely';
import type { Task } from '../runner.js';

/** How long before expiry the owner is reminded (FR-LST-07: "reminder at day 6" of 7). */
export const REMINDER_BEFORE_HOURS = 24;
/** Per run; anything left is taken by the next tick (5 minutes later). */
export const BATCH = 500;

export function listingExpiryReminders(batch = BATCH): Task {
  return {
    name: 'listings.remind-expiring',
    async run({ db }) {
      const { rows } = await sql<{ id: string; owner_id: string }>`
        with due as (
          select id
            from public.listings
           where status = 'active'
             and deleted_at is null
             and expires_at > now()
             and expires_at <= now() + make_interval(hours => ${REMINDER_BEFORE_HOURS})
             and expiry_reminded_for is distinct from expires_at
           order by expires_at
           limit ${batch}
           for update skip locked
        ),
        marked as (
          update public.listings l set expiry_reminded_for = l.expires_at
            from due where l.id = due.id
          returning l.id, l.owner_id
        )
        insert into public.notifications (user_id, type, title_key, params, deep_link)
        select owner_id, 'listing.expiring', 'notifications.listing.expiring',
               jsonb_build_object('listingId', id), 'flatrimony://my-flat'
          from marked
        returning user_id as owner_id, (params ->> 'listingId') as id`.execute(db);
      return { reminded: rows.length };
    },
  };
}

export function listingExpiry(batch = BATCH): Task {
  return {
    name: 'listings.expire',
    async run({ db }) {
      const { rows } = await sql<{ id: string }>`
        with due as (
          select id
            from public.listings
           where status = 'active' and deleted_at is null and expires_at <= now()
           order by expires_at
           limit ${batch}
           for update skip locked
        ),
        expired as (
          update public.listings l set status = 'expired'
            from due where l.id = due.id
          returning l.id, l.owner_id
        )
        insert into public.notifications (user_id, type, title_key, params, deep_link)
        select owner_id, 'listing.expired', 'notifications.listing.expired',
               jsonb_build_object('listingId', id), 'flatrimony://my-flat'
          from expired
        returning (params ->> 'listingId') as id`.execute(db);
      return { expired: rows.length };
    },
  };
}
