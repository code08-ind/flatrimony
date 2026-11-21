/**
 * Commute zones (FR-BIO-03, ADR-0008): the area reachable from an office or college within the
 * user's maximum commute. Road modes come from Valhalla isochrones on the NCR OpenStreetMap tiles
 * (apps/routing); metro/transit has no routed source yet (Delhi Metro GTFS: founder decision), so
 * it — and any road mode while routing is unavailable — uses a radius approximation.
 */
import type { LatLng, TravelMode } from '@flatrimony/shared';

/** GeoJSON MultiPolygon in [lng, lat] order (what PostGIS `ST_GeomFromGeoJSON` reads). */
export interface MultiPolygon {
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
}

/** Valhalla costing per travel mode; null where no routed zone exists yet (ADR-0008). */
export const COSTING: Record<TravelMode, 'auto' | 'motorcycle' | 'pedestrian' | null> = {
  car: 'auto',
  two_wheeler: 'motorcycle',
  walk: 'pedestrian',
  metro_transit: null,
};

/**
 * Straight-line speeds (km/h) for the radius approximation. Assumptions for city traffic, not
 * measurements: to be reviewed by the founder (docs/07 T2.9). Only used when no routed zone exists.
 */
export const FALLBACK_SPEED_KMH: Record<TravelMode, number> = {
  car: 20,
  two_wheeler: 20,
  metro_transit: 20,
  walk: 4,
};

const EARTH_RADIUS_KM = 6371;

/** A circle of `minutes` at the fallback speed, as a 48-point polygon (closed ring). */
export function radiusZone(
  center: LatLng,
  mode: TravelMode,
  minutes: number,
  points = 48,
): MultiPolygon {
  const radiusKm = (FALLBACK_SPEED_KMH[mode] * minutes) / 60;
  const d = radiusKm / EARTH_RADIUS_KM; // angular distance
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i < points; i += 1) {
    const bearing = (2 * Math.PI * i) / points;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([round((lng2 * 180) / Math.PI), round((lat2 * 180) / Math.PI)]);
  }
  ring.push(ring[0]!);
  return { type: 'MultiPolygon', coordinates: [[ring]] };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** A routing failure. `retryable` (timeout, 5xx, 429): try later; otherwise (no road near the point, an unrouted mode): use the approximation. */
export class RoutingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

/** The Valhalla `/isochrone` request for one location and one time contour. */
export function isochroneRequest(location: LatLng, mode: TravelMode, minutes: number) {
  const costing = COSTING[mode];
  if (!costing) throw new RoutingError(`no routed zone for ${mode}`, false);
  return {
    locations: [{ lat: location.lat, lon: location.lng }],
    costing,
    contours: [{ time: minutes }],
    polygons: true,
    // Smooth small holes and simplify (metres) so stored zones stay small.
    denoise: 0.5,
    generalize: 50,
  };
}

/** Calls the routing service and returns the zone. Throws RoutingError. */
export async function fetchIsochrone(opts: {
  baseUrl: string;
  location: LatLng;
  mode: TravelMode;
  minutes: number;
  /** Google ID token for a private Cloud Run service; none locally. */
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<MultiPolygon> {
  const body = isochroneRequest(opts.location, opts.mode, opts.minutes);
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl.replace(/\/$/, '')}/isochrone`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (err) {
    throw new RoutingError(`routing unreachable: ${(err as Error).name}`, true);
  }
  if (!res.ok) {
    // Valhalla answers 400 for a point with no road nearby (error_code 171) and the like.
    const retryable = res.status >= 500 || res.status === 429;
    throw new RoutingError(`routing answered ${res.status}`, retryable);
  }
  return toMultiPolygon(await res.json().catch(() => null));
}

/** The zone from a Valhalla isochrone FeatureCollection (Polygon or MultiPolygon geometry). */
export function toMultiPolygon(body: unknown): MultiPolygon {
  const geometry = (
    body as { features?: { geometry?: { type?: string; coordinates?: unknown } }[] }
  )?.features?.[0]?.geometry;
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? (geometry.coordinates as unknown[])
        : null;
  if (!polygons || polygons.length === 0 || !polygons.every(isPolygon))
    throw new RoutingError('routing returned no usable polygon', false);
  return { type: 'MultiPolygon', coordinates: polygons as [number, number][][][] };
}

const isPosition = (p: unknown) =>
  Array.isArray(p) &&
  p.length >= 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0] as number) <= 180 &&
  Math.abs(p[1] as number) <= 90;
const isPolygon = (poly: unknown) =>
  Array.isArray(poly) &&
  poly.length > 0 &&
  poly.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition));

/**
 * A Google-signed ID token for calling a private Cloud Run service (audience = its URL), from the
 * metadata server. Only available on Google Cloud; callers skip it locally.
 */
export async function googleIdToken(audience: string, fetchImpl: typeof fetch = fetch) {
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  const res = await fetchImpl(url, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(3_000),
  });
  if (!res.ok) throw new RoutingError(`identity token: ${res.status}`, true);
  return res.text();
}
