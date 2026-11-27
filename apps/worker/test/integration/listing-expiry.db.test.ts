/**
 * Listing expiry and reminders on Postgres (T3.10; FR-LST-07). Live listings are inserted with
 * triggers off for that one transaction (`session_replication_role = replica`), so they need no
 * photos, video or verified owner: this checks which listings the tick picks, not the listing rules
 * (pgTAP covers those). Skipped without DATABASE_URL.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/db.js';
import { createLogger } from '../../src/log.js';
import { listingExpiry, listingExpiryReminders } from '../../src/tasks/listing-expiry.js';

const URL = process.env.DATABASE_URL;

describe.skipIf(!URL)('listing expiry and reminders (Postgres)', () => {
  let db: Database;
  const owner = randomUUID();
  const ctx = () => ({
    db,
    log: createLogger('error', () => {}),
    signal: new AbortController().signal,
  });

  /** A live listing whose 7 days end `hoursLeft` from now (negative: already over). */
  async function live(
    hoursLeft: number,
    over: { status?: string; deleted?: boolean; remindedForOldWeek?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.transaction().execute(async (tx) => {
      await sql`set local session_replication_role = replica`.execute(tx);
      await sql`insert into public.listings (id, owner_id, status, title, area_id, location_exact, bhk,
          room_type, furnishing, available_from, total_flatmates, current_flatmates,
          rent_per_person_inr, deposit_per_person_inr, published_at, last_confirmed_at, expires_at,
          expiry_reminded_for, deleted_at)
        values (${id}, ${owner}, ${over.status ?? 'active'}::public.listing_status, 'Sunny room near Cyber Hub',
          (select min(id) from ref.areas), extensions.st_point(77.0891, 28.4951)::extensions.geography,
          3, 'private', 'semi_furnished', '2026-12-15', 3, 2, 18000, 36000,
          now() - interval '30 days',
          now() + (${hoursLeft} * interval '1 hour') - interval '7 days',
          now() + (${hoursLeft} * interval '1 hour'),
          ${over.remindedForOldWeek ? sql`now() + (${hoursLeft} * interval '1 hour') - interval '7 days'` : null},
          ${over.deleted ? sql`now()` : null})`.execute(tx);
    });
    return id;
  }

  /** What the API's "Still available" does: 7 more days from now. */
  const confirm = (id: string) =>
    sql`update public.listings set last_confirmed_at = now(), expires_at = now() + interval '7 days'
         where id = ${id}`.execute(db);
  /** Moves a listing's week so it ends `hoursLeft` from now (as if time passed). */
  const endIn = (id: string, hoursLeft: number) =>
    sql`update public.listings set expires_at = now() + (${hoursLeft} * interval '1 hour')
         where id = ${id}`.execute(db);

  const statusOf = async (id: string) =>
    (
      await sql<{
        status: string;
      }>`select status::text from public.listings where id = ${id}`.execute(db)
    ).rows[0]!.status;
  const notesFor = async (id: string) =>
    (
      await sql<{
        type: string;
        title_key: string;
        deep_link: string;
      }>`select type, title_key, deep_link from public.notifications
          where user_id = ${owner} and params ->> 'listingId' = ${id} order by created_at`.execute(
        db,
      )
    ).rows;

  beforeAll(async () => {
    db = createDatabase(URL!);
    const phone = `9194${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    await sql`insert into auth.users (id, aud, role, phone) values (${owner}, 'authenticated', 'authenticated', ${phone})`.execute(
      db,
    );
    await sql`insert into public.profiles (id, display_name, intent) values (${owner}, 'Meera', 'have_room')`.execute(
      db,
    );
  });
  afterAll(async () => {
    await sql`delete from auth.users where id = ${owner}`.execute(db);
    await db.destroy();
  });

  it('reminds once during the last day; only within the last 24 hours', async () => {
    const soon = await live(10);
    const edge = await live(23.9);
    const later = await live(25);
    const reminder = listingExpiryReminders();
    await reminder.run(ctx());
    expect(await notesFor(soon)).toEqual([
      {
        type: 'listing.expiring',
        title_key: 'notifications.listing.expiring',
        deep_link: 'flatrimony://my-flat',
      },
    ]);
    expect(await notesFor(edge)).toHaveLength(1);
    expect(await notesFor(later)).toEqual([]);
    // The next tick does not remind again.
    await reminder.run(ctx());
    expect(await notesFor(soon)).toHaveLength(1);
  });

  it('after "Still available", the next week gets its own reminder', async () => {
    const id = await live(5);
    await listingExpiryReminders().run(ctx());
    expect(await notesFor(id)).toHaveLength(1);
    await confirm(id); // 7 more days: nothing due now
    await listingExpiryReminders().run(ctx());
    expect(await notesFor(id)).toHaveLength(1);
    await endIn(id, 6); // the new week nears its end
    await listingExpiryReminders().run(ctx());
    expect((await notesFor(id)).map((n) => n.type)).toEqual([
      'listing.expiring',
      'listing.expiring',
    ]);
    // A reminder left over from an earlier week does not count for this one.
    const old = await live(3, { remindedForOldWeek: true });
    await listingExpiryReminders().run(ctx());
    expect(await notesFor(old)).toHaveLength(1);
  });

  it('expires live listings past their time, tells the owner, and leaves the rest alone', async () => {
    const over = await live(-1);
    const fresh = await live(30);
    const paused = await live(-5, { status: 'paused' });
    const held = await live(-5, { status: 'pending_review' });
    const deleted = await live(-5, { deleted: true });
    // A listing past its time is not reminded any more, only expired.
    await listingExpiryReminders().run(ctx());
    expect(await notesFor(over)).toEqual([]);
    const result = await listingExpiry().run(ctx());
    expect(result).toMatchObject({ expired: expect.any(Number) });
    expect(await statusOf(over)).toBe('expired');
    expect((await notesFor(over)).map((n) => n.type)).toEqual(['listing.expired']);
    expect(await statusOf(fresh)).toBe('active');
    expect(await statusOf(paused)).toBe('paused');
    expect(await statusOf(held)).toBe('pending_review');
    expect(await notesFor(deleted)).toEqual([]);
    // Again: nothing more happens.
    await listingExpiry().run(ctx());
    expect(await notesFor(over)).toHaveLength(1);
  });

  it('a listing locked by another transaction (an owner confirming) is skipped, then taken', async () => {
    const id = await live(-1);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    // Hold the row as the API's confirm does (select … for update), without committing yet.
    const other = createDatabase(URL!);
    const holding = other.transaction().execute(async (tx) => {
      await sql`select id from public.listings where id = ${id} for update`.execute(tx);
      locked();
      await held;
    });
    await lockTaken;
    await listingExpiry().run(ctx());
    expect(await statusOf(id)).toBe('active'); // skipped, not waited for
    release();
    await holding;
    await other.destroy();
    await listingExpiry().run(ctx());
    expect(await statusOf(id)).toBe('expired');
    expect(await notesFor(id)).toHaveLength(1);
  });

  it('notifications carry no personal data: an id, a key and a deep link', async () => {
    const id = await live(2);
    await listingExpiryReminders().run(ctx());
    const { rows } = await sql<{
      params: Record<string, unknown>;
    }>`select params from public.notifications where params ->> 'listingId' = ${id}`.execute(db);
    expect(rows[0]!.params).toEqual({ listingId: id });
  });
});
