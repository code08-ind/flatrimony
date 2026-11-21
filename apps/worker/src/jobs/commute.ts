/**
 * `commute.compute` (FR-BIO-03, ADR-0008; docs/04 §11): draws a user's commute zone from their
 * anchor (office or college, travel mode, maximum minutes) and stores it in `public.commute_zones`.
 * Road modes come from the routing service (Valhalla); metro/transit, a point with no road nearby
 * and a missing routing service give the radius approximation (`fallback_radius`). When routing is
 * temporarily down the approximation is stored at once and the job fails to try again later.
 * The zone is stored only if the anchor still matches what was drawn (the user may have moved it
 * meanwhile); otherwise the new anchor is drawn.
 */
import { sql } from 'kysely';
import { z } from 'zod';
import type { TravelMode } from '@flatrimony/shared';
import {
  COSTING,
  fetchIsochrone,
  radiusZone,
  RoutingError,
  type MultiPolygon,
} from '@flatrimony/routing';
import type { Database } from '../db.js';
import { enqueue } from '../queue.js';
import { defineJob, type Task } from '../runner.js';

export const COMMUTE_KIND = 'commute.compute';
export const commuteDedupeKey = (userId: string) => `commute:${userId}`;
/** Zones older than this are redrawn (docs/04 §11 daily tasks: fresh OpenStreetMap data). */
export const COMMUTE_ZONE_MAX_AGE_DAYS = 30;

export interface RoutingConfig {
  /** The routing service; without it every zone is the approximation. */
  url?: string;
  /** A Google ID token for the private Cloud Run service (none locally). */
  token?: (audience: string) => Promise<string>;
  fetchImpl?: typeof fetch;
}

interface AnchorRow {
  lat: number;
  lng: number;
  travel_mode: TravelMode;
  max_commute_min: number;
}

const loadAnchor = (db: Database, userId: string) =>
  db
    .selectFrom('anchors')
    .select([
      sql<number>`extensions.st_y(location::extensions.geometry)`.as('lat'),
      sql<number>`extensions.st_x(location::extensions.geometry)`.as('lng'),
      'travel_mode',
      'max_commute_min',
    ])
    .where('user_id', '=', userId)
    .executeTakeFirst() as Promise<AnchorRow | undefined>;

const same = (a: AnchorRow, b: AnchorRow) =>
  Number(a.lat) === Number(b.lat) &&
  Number(a.lng) === Number(b.lng) &&
  a.travel_mode === b.travel_mode &&
  a.max_commute_min === b.max_commute_min;

/**
 * Stores the zone if the anchor still matches `drawn`. Returns 'stored', 'gone' (no anchor any
 * more) or 'moved' (the anchor changed while drawing).
 */
async function store(
  db: Database,
  userId: string,
  drawn: AnchorRow,
  zone: MultiPolygon,
  source: 'valhalla' | 'fallback_radius',
): Promise<'stored' | 'gone' | 'moved'> {
  return db.transaction().execute(async (tx) => {
    // Lock the anchor row: a concurrent PUT /me/anchor waits until the zone is stored or not.
    const now = (await tx
      .selectFrom('anchors')
      .select([
        sql<number>`extensions.st_y(location::extensions.geometry)`.as('lat'),
        sql<number>`extensions.st_x(location::extensions.geometry)`.as('lng'),
        'travel_mode',
        'max_commute_min',
      ])
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst()) as AnchorRow | undefined;
    if (!now) return 'gone';
    if (!same(now, drawn)) return 'moved';
    const row = {
      travel_mode: drawn.travel_mode,
      max_minutes: drawn.max_commute_min,
      zone: sql<string>`extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(extensions.st_setsrid(extensions.st_geomfromgeojson(${JSON.stringify(zone)}), 4326)), 3))::extensions.geography`,
      source,
      computed_at: sql<Date>`now()`,
    };
    await tx
      .insertInto('commute_zones')
      .values({ user_id: userId, ...row })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(row))
      .execute();
    return 'stored';
  });
}

/** Draws the zone for an anchor: routed where possible, else the approximation. */
async function draw(
  anchor: AnchorRow,
  routing: RoutingConfig,
  signal: AbortSignal,
): Promise<{ zone: MultiPolygon; source: 'valhalla' | 'fallback_radius'; retry?: RoutingError }> {
  const location = { lat: Number(anchor.lat), lng: Number(anchor.lng) };
  const approx = () => radiusZone(location, anchor.travel_mode, anchor.max_commute_min);
  if (!routing.url || !COSTING[anchor.travel_mode])
    return { zone: approx(), source: 'fallback_radius' };
  try {
    const zone = await fetchIsochrone({
      baseUrl: routing.url,
      location,
      mode: anchor.travel_mode,
      minutes: anchor.max_commute_min,
      token: routing.token ? await routing.token(routing.url) : undefined,
      fetchImpl: routing.fetchImpl,
      timeoutMs: 20_000,
    });
    if (signal.aborted) throw new RoutingError('stopped', true);
    return { zone, source: 'valhalla' };
  } catch (err) {
    const e = err instanceof RoutingError ? err : new RoutingError((err as Error).message, true);
    // A final answer (no road near the point): the approximation is the zone. A temporary one:
    // the approximation for now, and the job is retried.
    return { zone: approx(), source: 'fallback_radius', ...(e.retryable ? { retry: e } : {}) };
  }
}

export function commuteJob(routing: RoutingConfig) {
  return defineJob({
    payload: z.object({ userId: z.uuid() }),
    async run({ userId }, { db, log, signal, job }) {
      // At most three rounds: a user moving the pin repeatedly while it is drawn.
      for (let round = 0; round < 3; round += 1) {
        const anchor = await loadAnchor(db, userId);
        if (!anchor) return; // anchor removed: nothing to draw
        const { zone, source, retry } = await draw(anchor, routing, signal);
        const outcome = await store(db, userId, anchor, zone, source);
        if (outcome === 'moved') continue;
        if (outcome === 'stored')
          log.info('commute zone stored', {
            jobId: job.id,
            source,
            travelMode: anchor.travel_mode,
            minutes: anchor.max_commute_min,
          });
        if (retry) throw retry; // stored the approximation; try routing again later
        return;
      }
      throw new Error('anchor kept changing; trying again later');
    },
  });
}

/**
 * Daily: enqueue `commute.compute` for anchors without a matching zone (missed or failed), zones
 * older than 30 days, and road-mode zones that are still the approximation. Never more than
 * `limit` per day; a user with a pending job is skipped (dedupe key).
 */
export function commuteRefresh(limit = 500): Task {
  return {
    name: 'commute.refresh',
    async run({ db }) {
      const routed = Object.entries(COSTING)
        .filter(([, costing]) => costing)
        .map(([mode]) => mode);
      const { rows } = await sql<{ user_id: string }>`
        select a.user_id from public.anchors a
          left join public.commute_zones z on z.user_id = a.user_id
         where z.user_id is null
            or z.travel_mode <> a.travel_mode or z.max_minutes <> a.max_commute_min
            or z.computed_at < now() - make_interval(days => ${COMMUTE_ZONE_MAX_AGE_DAYS})
            or (z.source = 'fallback_radius' and a.travel_mode::text = any(${routed}))
         order by z.computed_at nulls first
         limit ${limit}`.execute(db);
      let enqueued = 0;
      for (const { user_id } of rows)
        if (
          await enqueue(
            db,
            COMMUTE_KIND,
            { userId: user_id },
            { dedupeKey: commuteDedupeKey(user_id) },
          )
        )
          enqueued += 1;
      return { candidates: rows.length, enqueued };
    },
  };
}
