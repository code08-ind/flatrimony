import { describe, expect, it } from 'vitest';
import {
  COSTING,
  fetchIsochrone,
  googleIdToken,
  isochroneRequest,
  radiusZone,
  RoutingError,
  toMultiPolygon,
} from './index.js';

const cyberCity = { lat: 28.495, lng: 77.089 };
const polygon = [
  [
    [77.0, 28.4],
    [77.2, 28.4],
    [77.2, 28.6],
    [77.0, 28.4],
  ],
];
const featureCollection = (geometry: unknown) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry }],
});

/** Distance in km between two [lng, lat] points (haversine). */
const km = ([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};

describe('travel modes (ADR-0008)', () => {
  it('road modes are routed; metro/transit is not yet', () => {
    expect(COSTING).toEqual({
      car: 'auto',
      two_wheeler: 'motorcycle',
      walk: 'pedestrian',
      metro_transit: null,
    });
    expect(() => isochroneRequest(cyberCity, 'metro_transit', 45)).toThrow(RoutingError);
  });

  it('asks Valhalla for one contour of the commute minutes, as polygons', () => {
    expect(isochroneRequest(cyberCity, 'two_wheeler', 30)).toMatchObject({
      locations: [{ lat: 28.495, lon: 77.089 }],
      costing: 'motorcycle',
      contours: [{ time: 30 }],
      polygons: true,
    });
  });
});

describe('radius approximation', () => {
  it('is a closed ring at the fallback speed (20 km/h by car: 15 km in 45 min)', () => {
    const zone = radiusZone(cyberCity, 'car', 45);
    const ring = zone.coordinates[0]![0]!;
    expect(ring).toHaveLength(49);
    expect(ring[0]).toEqual(ring[48]);
    const center: [number, number] = [cyberCity.lng, cyberCity.lat];
    for (const p of ring) expect(km(center, p)).toBeCloseTo(15, 1);
  });

  it('walking reaches far less than driving', () => {
    const walk = radiusZone(cyberCity, 'walk', 30).coordinates[0]![0]![0]!;
    expect(km([cyberCity.lng, cyberCity.lat], walk)).toBeCloseTo(2, 1);
  });
});

describe('routing service client', () => {
  const answer = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('returns the zone as a MultiPolygon and sends the token', async () => {
    let seen: RequestInit | undefined;
    let url = '';
    const zone = await fetchIsochrone({
      baseUrl: 'http://routing.test/',
      location: cyberCity,
      mode: 'car',
      minutes: 45,
      token: 'id-token',
      fetchImpl: (async (u: string, init: RequestInit) => {
        url = u;
        seen = init;
        return answer(200, featureCollection({ type: 'Polygon', coordinates: polygon }))();
      }) as typeof fetch,
    });
    expect(url).toBe('http://routing.test/isochrone');
    expect((seen!.headers as Record<string, string>).authorization).toBe('Bearer id-token');
    expect(zone).toEqual({ type: 'MultiPolygon', coordinates: [polygon] });
  });

  it('keeps MultiPolygon answers as they are', async () => {
    const zone = await fetchIsochrone({
      baseUrl: 'http://routing.test',
      location: cyberCity,
      mode: 'walk',
      minutes: 20,
      fetchImpl: answer(
        200,
        featureCollection({ type: 'MultiPolygon', coordinates: [polygon, polygon] }),
      ) as typeof fetch,
    });
    expect(zone.coordinates).toHaveLength(2);
  });

  it('retryable: unreachable, 5xx, 429; final: 400 (no road nearby), bad answers', async () => {
    const call = (fetchImpl: typeof fetch) =>
      fetchIsochrone({
        baseUrl: 'http://r',
        location: cyberCity,
        mode: 'car',
        minutes: 30,
        fetchImpl,
      }).then(
        () => null,
        (e: RoutingError) => e.retryable,
      );
    expect(
      await call((async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch),
    ).toBe(true);
    expect(await call(answer(503, {}) as typeof fetch)).toBe(true);
    expect(await call(answer(429, {}) as typeof fetch)).toBe(true);
    expect(await call(answer(400, { error_code: 171 }) as typeof fetch)).toBe(false);
    expect(await call(answer(200, { features: [] }) as typeof fetch)).toBe(false);
    expect(
      await call((async () => new Response('not json', { status: 200 })) as typeof fetch),
    ).toBe(false);
  });

  it('rejects polygons with impossible coordinates', () => {
    expect(() =>
      toMultiPolygon(
        featureCollection({
          type: 'Polygon',
          coordinates: [
            [
              [500, 28],
              [77, 28],
              [77, 29],
              [500, 28],
            ],
          ],
        }),
      ),
    ).toThrow(RoutingError);
    expect(() =>
      toMultiPolygon(featureCollection({ type: 'Point', coordinates: [77, 28] })),
    ).toThrow(RoutingError);
    expect(() => toMultiPolygon(null)).toThrow(RoutingError);
  });
});

describe('Google ID token (private Cloud Run)', () => {
  it('asks the metadata server for the audience', async () => {
    let url = '';
    let headers: Record<string, string> = {};
    const token = await googleIdToken('https://routing-xyz.a.run.app', (async (
      u: string,
      init: RequestInit,
    ) => {
      url = u;
      headers = init.headers as Record<string, string>;
      return new Response('signed.jwt');
    }) as typeof fetch);
    expect(token).toBe('signed.jwt');
    expect(url).toContain('audience=https%3A%2F%2Frouting-xyz.a.run.app');
    expect(headers['Metadata-Flavor']).toBe('Google');
    await expect(
      googleIdToken('x', (async () => new Response('', { status: 404 })) as typeof fetch),
    ).rejects.toThrow(RoutingError);
  });
});
