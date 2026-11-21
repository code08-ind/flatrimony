/**
 * `commute.compute` and the daily commute refresh on Postgres (T2.9), with a fake routing service.
 * Needs DATABASE_URL; skipped without it. Users are created and removed by the test.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/db.js';
import { COMMUTE_KIND, commuteJob, commuteRefresh } from '../../src/jobs/commute.js';
import { createLogger } from '../../src/log.js';
import { enqueue } from '../../src/queue.js';
import { runWorker, type AnyJobDefinition } from '../../src/runner.js';

const URL = process.env.DATABASE_URL;
const log = createLogger('error', () => {});

/** A routed zone around the point (a small square), as Valhalla would answer. */
const square = (lng: number, lat: number) => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [lng - 0.05, lat - 0.05],
            [lng + 0.05, lat - 0.05],
            [lng + 0.05, lat + 0.05],
            [lng - 0.05, lat + 0.05],
            [lng - 0.05, lat - 0.05],
          ],
        ],
      },
    },
  ],
});

describe.skipIf(!URL)('commute.compute (Postgres)', () => {
  let db: Database;
  const users: string[] = [];

  beforeAll(() => {
    db = createDatabase(URL!, { max: 3 });
  });
  afterAll(async () => {
    if (users.length) {
      await sql`delete from private.jobs where dedupe_key = any(${users.map((u) => `commute:${u}`)}::text[])`.execute(
        db,
      );
      await sql`delete from auth.users where id = any(${users}::uuid[])`.execute(db);
    }
    await db.destroy();
  });

  async function userWithAnchor(mode: string, minutes = 30, at = { lat: 28.495, lng: 77.089 }) {
    const id = randomUUID();
    users.push(id);
    const phone = `9197${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    await sql`insert into auth.users (id, aud, role, phone) values (${id}, 'authenticated', 'authenticated', ${phone})`.execute(
      db,
    );
    await sql`insert into public.profiles (id, display_name, intent) values (${id}, 'Test', 'need_room')`.execute(
      db,
    );
    await setAnchor(id, mode, minutes, at);
    return id;
  }
  const setAnchor = (id: string, mode: string, minutes: number, at: { lat: number; lng: number }) =>
    sql`insert into public.anchors (user_id, kind, label, location, travel_mode, max_commute_min)
        values (${id}, 'office', 'Office',
                extensions.st_setsrid(extensions.st_makepoint(${at.lng}, ${at.lat}), 4326)::extensions.geography,
                ${mode}::public.travel_mode, ${minutes})
        on conflict (user_id) do update set location = excluded.location,
          travel_mode = excluded.travel_mode, max_commute_min = excluded.max_commute_min`.execute(
      db,
    );
  const zoneOf = async (id: string) =>
    (
      await sql<{
        source: string;
        travel_mode: string;
        max_minutes: number;
        area_km2: number;
        contains: boolean;
      }>`select source, travel_mode, max_minutes,
                extensions.st_area(zone) / 1e6 as area_km2,
                extensions.st_covers(zone, extensions.st_point(77.089, 28.495)::extensions.geography) as contains
           from public.commute_zones where user_id = ${id}`.execute(db)
    ).rows[0];

  /** Runs one worker pass over this user's job. */
  async function compute(
    id: string,
    fetchImpl: typeof fetch,
    routingUrl: string | null = 'http://routing.test',
  ) {
    await enqueue(db, COMMUTE_KIND, { userId: id }, { dedupeKey: `commute:${id}` });
    const jobs: Record<string, AnyJobDefinition> = {
      [COMMUTE_KIND]: commuteJob({ url: routingUrl ?? undefined, fetchImpl }),
    };
    return runWorker({
      mode: 'drain',
      db,
      log,
      workerId: 'w-commute',
      jobs,
      tasks: { tick: [], daily: [] },
      budgetMs: 30_000,
      scope: { kindPrefix: COMMUTE_KIND },
    });
  }
  const routed = (body: unknown, status = 200) => {
    const calls: unknown[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };

  it('a road mode stores the routed zone (Valhalla)', async () => {
    const id = await userWithAnchor('two_wheeler', 25);
    const r = routed(square(77.089, 28.495));
    const result = await compute(id, r.fetchImpl);
    expect(result.jobsDone).toBe(1);
    expect(r.calls[0]).toMatchObject({ costing: 'motorcycle', contours: [{ time: 25 }] });
    const zone = await zoneOf(id);
    expect(zone).toMatchObject({
      source: 'valhalla',
      travel_mode: 'two_wheeler',
      max_minutes: 25,
      contains: true,
    });
    expect(zone!.area_km2).toBeGreaterThan(50); // ~0.1° square around NCR
    expect(zone!.area_km2).toBeLessThan(150);
  });

  it('metro/transit stores the radius approximation without calling routing', async () => {
    const id = await userWithAnchor('metro_transit', 45);
    const r = routed(square(77.089, 28.495));
    expect((await compute(id, r.fetchImpl)).jobsDone).toBe(1);
    expect(r.calls).toHaveLength(0);
    const zone = await zoneOf(id);
    expect(zone).toMatchObject({ source: 'fallback_radius', contains: true });
    // 20 km/h for 45 min: a 15 km circle, about 707 km².
    expect(zone!.area_km2).toBeGreaterThan(650);
    expect(zone!.area_km2).toBeLessThan(720);
  });

  it('no road near the point (400) or routing down (503): the approximation, and the job is done', async () => {
    const lonely = await userWithAnchor('car', 30);
    expect((await compute(lonely, routed({ error_code: 171 }, 400).fetchImpl)).jobsDone).toBe(1);
    expect((await zoneOf(lonely))!.source).toBe('fallback_radius');

    // Routing down: no retries that could die and block the refresh; commute.refresh redraws it.
    const down = await userWithAnchor('car', 30);
    expect((await compute(down, routed({}, 503).fetchImpl)).jobsDone).toBe(1);
    expect((await zoneOf(down))!.source).toBe('fallback_radius');
    const pending = await db
      .selectFrom('private.jobs')
      .select('id')
      .where('dedupe_key', '=', `commute:${down}`)
      .execute();
    expect(pending).toEqual([]);
  });

  it('a zone that does not reach the pin (Valhalla snapped far away): the approximation', async () => {
    const id = await userWithAnchor('car', 30);
    expect((await compute(id, routed(square(77.6, 29.4)).fetchImpl)).jobsDone).toBe(1);
    expect((await zoneOf(id))!).toMatchObject({ source: 'fallback_radius', contains: true });
  });

  it('a degenerate routed shape (no area) is never stored; the approximation is', async () => {
    const id = await userWithAnchor('car', 30);
    const flat = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [77.0, 28.495],
                [77.089, 28.495],
                [77.2, 28.495],
                [77.0, 28.495],
              ],
            ],
          },
        },
      ],
    };
    expect((await compute(id, routed(flat).fetchImpl)).jobsDone).toBe(1);
    expect((await zoneOf(id))!.source).toBe('fallback_radius');
  });

  it('a re-run request while the job runs (PUT /me/anchor): it runs once more instead of finishing', async () => {
    const id = await userWithAnchor('car', 30);
    let calls = 0;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls += 1;
      if (calls === 1)
        // The anchor changes and the API asks for a run while this job is still locked.
        await sql`insert into private.jobs (kind, payload, dedupe_key)
          values ('commute.compute', ${JSON.stringify({ userId: id })}::jsonb, ${`commute:${id}`})
          on conflict (dedupe_key) do update set run_after = clock_timestamp(),
            attempts = case when private.jobs.locked_at is null then 0 else private.jobs.attempts end
          where private.jobs.done_at is null`.execute(db);
      const req = JSON.parse(String(init.body)) as { locations: { lat: number; lon: number }[] };
      return new Response(JSON.stringify(square(req.locations[0]!.lon, req.locations[0]!.lat)));
    }) as typeof fetch;
    // The finished job goes back to the queue (ready at once), so the same run draws it again.
    const result = await compute(id, fetchImpl);
    expect(result.jobsDone).toBe(2);
    expect(calls).toBe(2);
    const left = await db
      .selectFrom('private.jobs')
      .select(['done_at', 'dedupe_key'])
      .where('payload', '@>', JSON.stringify({ userId: id }))
      .where('kind', '=', 'commute.compute')
      .execute();
    expect(left).toHaveLength(1);
    expect(left[0]!.done_at).not.toBeNull(); // finished after the second run
    expect(left[0]!.dedupe_key).toBeNull();
  });

  it('an anchor moved while drawing: the new anchor is drawn, never the old one', async () => {
    const id = await userWithAnchor('car', 30);
    let calls = 0;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls += 1;
      const req = JSON.parse(String(init.body)) as { locations: { lat: number; lon: number }[] };
      // The user moves the pin while the first zone is drawn.
      if (calls === 1) await setAnchor(id, 'car', 30, { lat: 28.627, lng: 77.365 });
      return new Response(JSON.stringify(square(req.locations[0]!.lon, req.locations[0]!.lat)));
    }) as typeof fetch;
    expect((await compute(id, fetchImpl)).jobsDone).toBe(1);
    expect(calls).toBe(2);
    const zone = await zoneOf(id);
    expect(zone!.contains).toBe(false); // drawn around Noida, not Cyber City
  });

  it('no routing service configured: the approximation for every mode', async () => {
    const id = await userWithAnchor('car', 30);
    const r = routed(square(77.089, 28.495));
    expect((await compute(id, r.fetchImpl, null)).jobsDone).toBe(1);
    expect(r.calls).toHaveLength(0);
    expect((await zoneOf(id))!.source).toBe('fallback_radius');
  });

  it('the daily refresh enqueues missing, mismatched, old and approximate road zones once', async () => {
    const missing = await userWithAnchor('walk', 20);
    const approxRoad = await userWithAnchor('car', 30);
    await compute(approxRoad, routed({}, 503).fetchImpl); // routing down: approximation stored
    const fresh = await userWithAnchor('car', 30);
    await compute(fresh, routed(square(77.089, 28.495)).fetchImpl);
    const old = await userWithAnchor('car', 30);
    await compute(old, routed(square(77.089, 28.495)).fetchImpl);
    await sql`update public.commute_zones set computed_at = now() - interval '31 days' where user_id = ${old}`.execute(
      db,
    );
    const transit = await userWithAnchor('metro_transit', 45);
    await compute(transit, routed({}).fetchImpl); // approximation is final for transit

    const pending = async (id: string) =>
      (
        await db
          .selectFrom('private.jobs')
          .select('id')
          .where('dedupe_key', '=', `commute:${id}`)
          .execute()
      ).length;
    await commuteRefresh(10_000).run({ db, log, signal: new AbortController().signal });
    expect(await pending(missing)).toBe(1);
    expect(await pending(old)).toBe(1);
    expect(await pending(approxRoad)).toBe(1); // a road zone still approximate: redrawn
    expect(await pending(fresh)).toBe(0);
    expect(await pending(transit)).toBe(0);
  });
});
