import { describe, expect, it } from 'vitest';
import { createCommutePreview } from '../src/lib/commute-preview.js';

const cyberCity = { lat: 28.495, lng: 77.089 };
const routed = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.0, 28.4],
            [77.2, 28.4],
            [77.2, 28.6],
            [77.0, 28.4],
          ],
        ],
      },
    },
  ],
};

/** A fake routing service that counts calls and answers `status` with `body`. */
function routing(status = 200, body: unknown = routed) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('commute preview (T2.9)', () => {
  it('routes road modes and caches per place (about 100 m), mode and minutes', async () => {
    const r = routing();
    const p = createCommutePreview({ routingUrl: 'http://routing.test', fetchImpl: r.fetchImpl });
    const first = await p.preview({ location: cyberCity, travelMode: 'car', maxCommuteMin: 45 });
    expect(first.approx).toBe(false);
    expect(first.zone.type).toBe('MultiPolygon');
    // 20 m away: same cache entry.
    await p.preview({
      location: { lat: 28.4951, lng: 77.0891 },
      travelMode: 'car',
      maxCommuteMin: 45,
    });
    expect(r.calls).toHaveLength(1);
    await p.preview({ location: cyberCity, travelMode: 'car', maxCommuteMin: 30 });
    await p.preview({ location: cyberCity, travelMode: 'walk', maxCommuteMin: 30 });
    expect(r.calls).toHaveLength(3);
  });

  it('metro/transit and a missing routing service give the approximation, without calling routing', async () => {
    const r = routing();
    const p = createCommutePreview({ routingUrl: 'http://routing.test', fetchImpl: r.fetchImpl });
    expect(
      (await p.preview({ location: cyberCity, travelMode: 'metro_transit', maxCommuteMin: 45 }))
        .approx,
    ).toBe(true);
    expect(r.calls).toHaveLength(0);
    const none = createCommutePreview({});
    expect(
      (await none.preview({ location: cyberCity, travelMode: 'car', maxCommuteMin: 45 })).approx,
    ).toBe(true);
  });

  it('routing down: the approximation now, and the next request tries routing again', async () => {
    const r = routing(503, {});
    const errors: boolean[] = [];
    const p = createCommutePreview({
      routingUrl: 'http://routing.test',
      fetchImpl: r.fetchImpl,
      onRoutingError: (e) => errors.push(e.retryable),
    });
    const req = { location: cyberCity, travelMode: 'car' as const, maxCommuteMin: 45 };
    expect((await p.preview(req)).approx).toBe(true);
    await p.preview(req);
    expect(r.calls).toHaveLength(2); // not cached
    expect(errors).toEqual([true, true]);
  });

  it('no road near the point: the approximation, cached', async () => {
    const r = routing(400, { error_code: 171 });
    const p = createCommutePreview({ routingUrl: 'http://routing.test', fetchImpl: r.fetchImpl });
    const req = { location: cyberCity, travelMode: 'car' as const, maxCommuteMin: 45 };
    expect((await p.preview(req)).approx).toBe(true);
    await p.preview(req);
    expect(r.calls).toHaveLength(1);
  });

  it('the cache forgets old entries (time and size)', async () => {
    let clock = 0;
    const r = routing();
    const p = createCommutePreview({
      routingUrl: 'http://routing.test',
      fetchImpl: r.fetchImpl,
      now: () => clock,
      cacheTtlMs: 1_000,
      cacheSize: 2,
    });
    const at = (lat: number) => ({
      location: { lat, lng: 77.1 },
      travelMode: 'car' as const,
      maxCommuteMin: 45,
    });
    await p.preview(at(28.4));
    clock = 2_000;
    await p.preview(at(28.4)); // expired
    await p.preview(at(28.5));
    await p.preview(at(28.6)); // evicts 28.4
    await p.preview(at(28.4));
    expect(r.calls).toHaveLength(5);
  });

  it('sends a Google ID token when configured (private Cloud Run)', async () => {
    let auth = '';
    const p = createCommutePreview({
      routingUrl: 'http://routing.test',
      token: async (audience) => `token-for-${audience}`,
      fetchImpl: (async (_u: string, init: RequestInit) => {
        auth = (init.headers as Record<string, string>).authorization ?? '';
        return new Response(JSON.stringify(routed));
      }) as typeof fetch,
    });
    await p.preview({ location: cyberCity, travelMode: 'two_wheeler', maxCommuteMin: 20 });
    expect(auth).toBe('Bearer token-for-http://routing.test');
  });
});
