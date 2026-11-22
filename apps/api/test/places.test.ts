import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { inMemorySystemRepository } from '../src/modules/system/repository.js';
import {
  googlePlacesProvider,
  mockPlacesProvider,
  PlacesUnavailable,
  type PlacesProvider,
} from '../src/modules/places/provider.js';

const areas = [
  {
    id: 1,
    slug: 'gurugram-cyber-city',
    name: 'Cyber City',
    city: 'gurugram' as const,
    centroid: { lat: 28.495, lng: 77.089 },
  },
  {
    id: 2,
    slug: 'delhi-hauz-khas',
    name: 'Hauz Khas',
    city: 'delhi' as const,
    centroid: { lat: 28.5494, lng: 77.2001 },
  },
];
const hindi = areas.map((a) => ({ ...a, name: a.id === 1 ? 'साइबर सिटी' : 'हौज़ ख़ास' }));
const mock = mockPlacesProvider(async (locale) => (locale === 'hi' ? hindi : areas));
const session = '9c3f1c2e-3a43-4b6e-9a3e-7d6f5c1b2a10';

describe('mock places (local and CI)', () => {
  it('finds seeded areas by name in either language, slug or city', async () => {
    expect(await mock.autocomplete('cyber', { sessionToken: session, locale: 'en' })).toEqual([
      { placeId: 'mock:gurugram-cyber-city', label: 'Cyber City', secondary: 'Gurugram' },
    ]);
    expect(await mock.autocomplete('साइबर', { sessionToken: session, locale: 'hi' })).toEqual([
      { placeId: 'mock:gurugram-cyber-city', label: 'साइबर सिटी', secondary: 'गुरुग्राम' },
    ]);
    expect(await mock.autocomplete('Cyber', { sessionToken: session, locale: 'hi' })).toHaveLength(
      1,
    );
    expect(
      (await mock.autocomplete('delhi', { sessionToken: session, locale: 'en' }))[0]!.label,
    ).toBe('Hauz Khas');
    expect(await mock.autocomplete('mumbai', { sessionToken: session, locale: 'en' })).toEqual([]);
  });

  it('details give the area centre; unknown ids are null', async () => {
    expect(await mock.details('mock:delhi-hauz-khas', { locale: 'en' })).toEqual({
      label: 'Hauz Khas',
      location: { lat: 28.5494, lng: 77.2001 },
    });
    expect(await mock.details('mock:nowhere', { locale: 'en' })).toBeNull();
    expect(await mock.details('ChIJ123', { locale: 'en' })).toBeNull();
  });
});

describe('Google Places (API New)', () => {
  function google(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = googlePlacesProvider({
      apiKey: 'test-key',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      }) as typeof fetch,
    });
    return { calls, provider };
  }

  it('autocomplete: NCR rectangle, India, session token, key in a header', async () => {
    const g = google(200, {
      suggestions: [
        {
          placePrediction: {
            placeId: 'ChIJ_cyber',
            text: { text: 'DLF Cyber City, Gurugram, Haryana' },
            structuredFormat: {
              mainText: { text: 'DLF Cyber City' },
              secondaryText: { text: 'Gurugram, Haryana' },
            },
          },
        },
        { queryPrediction: { text: { text: 'cyber cafe' } } },
      ],
    });
    const out = await g.provider.autocomplete('cyber city', {
      sessionToken: session,
      locale: 'hi',
    });
    expect(out).toEqual([
      { placeId: 'ChIJ_cyber', label: 'DLF Cyber City', secondary: 'Gurugram, Haryana' },
    ]);
    const { url, init } = g.calls[0]!;
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      input: 'cyber city',
      sessionToken: session,
      languageCode: 'hi',
      includedRegionCodes: ['in'],
      locationRestriction: {
        rectangle: {
          low: { latitude: 27.5, longitude: 76.0 },
          high: { latitude: 29.5, longitude: 78.5 },
        },
      },
    });
    expect(url).not.toContain('cyber'); // the search text is never in a URL
  });

  it('details: name and location only (field mask), session token; unknown → null', async () => {
    const g = google(200, {
      id: 'ChIJ_cyber',
      displayName: { text: 'DLF Cyber City' },
      location: { latitude: 28.4949, longitude: 77.0887 },
    });
    expect(await g.provider.details('ChIJ_cyber', { sessionToken: session, locale: 'en' })).toEqual(
      {
        label: 'DLF Cyber City',
        location: { lat: 28.4949, lng: 77.0887 },
      },
    );
    expect(g.calls[0]!.url).toBe(
      `https://places.googleapis.com/v1/places/ChIJ_cyber?languageCode=en&sessionToken=${session}`,
    );
    expect((g.calls[0]!.init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
      'id,displayName,location',
    );
    expect(await google(404, {}).provider.details('x', { locale: 'en' })).toBeNull();
    expect(
      await google(200, { displayName: { text: 'No location' } }).provider.details('x', {
        locale: 'en',
      }),
    ).toBeNull();
  });

  it('vendor down or failing: PlacesUnavailable', async () => {
    await expect(
      google(503, {}).provider.autocomplete('cyber', { sessionToken: session, locale: 'en' }),
    ).rejects.toThrow(PlacesUnavailable);
    const unreachable = googlePlacesProvider({
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(unreachable.details('x', { locale: 'en' })).rejects.toThrow(PlacesUnavailable);
  });
});

describe('/v1/places routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function setup(provider?: PlacesProvider) {
    const logs: string[] = [];
    app = await buildApp({
      env: loadEnv({ NODE_ENV: 'test' }),
      jwtVerifier: async (token) => {
        if (token !== 'a.b.c') throw new Error('bad token');
        return { id: '00000000-0000-4000-8000-000000000001', appRole: 'user' };
      },
      systemRepo: inMemorySystemRepository({
        reference: { areas, habitTags: [], scenarioQuestions: [], products: [] },
      }),
      ...(provider ? { placesProvider: provider } : {}),
      logStream: { write: (line) => void logs.push(line) },
    });
    const call = (method: 'GET' | 'POST', url: string, payload?: object, auth = true) =>
      app!.inject({
        method,
        url,
        headers: auth ? { authorization: 'Bearer a.b.c' } : {},
        ...(payload ? { payload } : {}),
      });
    return { call, logs };
  }

  it('search and details with the default (mock) provider; the search text is not logged', async () => {
    const { call, logs } = await setup();
    const res = await call('POST', '/v1/places/autocomplete', {
      q: 'Cyber',
      sessionToken: session,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions[0]).toMatchObject({ placeId: 'mock:gurugram-cyber-city' });
    const place = await call('GET', `/v1/places/mock:gurugram-cyber-city?sessionToken=${session}`);
    expect(place.json()).toEqual({
      placeId: 'mock:gurugram-cyber-city',
      label: 'Cyber City',
      location: { lat: 28.495, lng: 77.089 },
    });
    expect(logs.join('\n')).not.toContain('Cyber');
  });

  it('needs a session; validates input; unknown place 404; outside NCR 422; vendor down 503', async () => {
    const { call } = await setup({
      name: 'google',
      autocomplete: async () => {
        throw new PlacesUnavailable('places answered 503');
      },
      details: async (id) =>
        id === 'mumbai' ? { label: 'Mumbai office', location: { lat: 19.07, lng: 72.88 } } : null,
    });
    expect(
      (await call('POST', '/v1/places/autocomplete', { q: 'cyber', sessionToken: session }, false))
        .statusCode,
    ).toBe(401);
    for (const bad of [
      { q: 'c', sessionToken: session },
      { q: 'cyber' },
      { q: 'x'.repeat(101), sessionToken: session },
    ])
      expect((await call('POST', '/v1/places/autocomplete', bad)).statusCode).toBe(422);
    expect(
      (await call('POST', '/v1/places/autocomplete', { q: 'cyber', sessionToken: session }))
        .statusCode,
    ).toBe(503);
    expect((await call('GET', '/v1/places/unknown')).statusCode).toBe(404);
    const mumbai = await call('GET', '/v1/places/mumbai');
    expect(mumbai.statusCode).toBe(422);
    expect(mumbai.json().errors[0]).toMatchObject({ code: 'outside_ncr' });
    expect((await call('GET', '/v1/places/bad%20id')).statusCode).toBe(422);
  });

  it('google needs its key', () => {
    expect(() => loadEnv({ APP_ENV: 'local', PLACES_PROVIDER: 'google' })).toThrow(
      /GOOGLE_PLACES_API_KEY/,
    );
  });
});
