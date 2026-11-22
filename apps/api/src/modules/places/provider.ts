/**
 * Place search for the office/college picker (FR-BIO-03; docs/05 §8.5). The API keeps the vendor
 * key server-side and only ever searches inside Delhi NCR (`LIMITS.ncrBounds`).
 *
 * - `google`: Google Places API (New) autocomplete + place details, with session tokens (one billed
 *   session per search). Needs GOOGLE_PLACES_API_KEY: Blocked until the founder's Google Cloud
 *   project exists (docs/07 T2.8).
 * - `mock`: searches the seeded NCR areas (ref.areas) by name, for local development and CI. Never
 *   allowed in production.
 *
 * What users type is never logged (it can reveal where they work).
 */
import type { LatLng, PlaceSuggestion, ReferenceData } from '@flatrimony/shared';
import { LIMITS } from '@flatrimony/shared';

export interface PlacesProvider {
  readonly name: 'google' | 'mock';
  autocomplete(
    q: string,
    opts: { sessionToken: string; locale: 'en' | 'hi' },
  ): Promise<PlaceSuggestion[]>;
  /** The place, or null when the id is unknown. `label` null: use the suggestion's. */
  details(
    placeId: string,
    opts: { sessionToken: string; locale: 'en' | 'hi' },
  ): Promise<{ label: string | null; location: LatLng } | null>;
}

/** The vendor failed or is not reachable: the picker shows "search is unavailable". */
export class PlacesUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacesUnavailable';
  }
}

export const MAX_SUGGESTIONS = 5;

type Area = ReferenceData['areas'][number];

const CITY_LABEL: Record<Area['city'], { en: string; hi: string }> = {
  delhi: { en: 'Delhi', hi: 'दिल्ली' },
  gurugram: { en: 'Gurugram', hi: 'गुरुग्राम' },
  noida: { en: 'Noida', hi: 'नोएडा' },
  greater_noida: { en: 'Greater Noida', hi: 'ग्रेटर नोएडा' },
  ghaziabad: { en: 'Ghaziabad', hi: 'गाज़ियाबाद' },
  faridabad: { en: 'Faridabad', hi: 'फ़रीदाबाद' },
};

/** Local development and CI: the seeded NCR areas, found by name (either language) or slug. */
export function mockPlacesProvider(
  loadAreas: (locale: 'en' | 'hi') => Promise<Area[]>,
): PlacesProvider {
  const find = async (locale: 'en' | 'hi') => {
    const [mine, other] = await Promise.all([
      loadAreas(locale),
      loadAreas(locale === 'en' ? 'hi' : 'en'),
    ]);
    return mine.map((a) => ({ ...a, otherName: other.find((o) => o.id === a.id)?.name ?? '' }));
  };
  return {
    name: 'mock',
    async autocomplete(q, { locale }) {
      const needle = q.trim().toLowerCase();
      return (await find(locale))
        .filter((a) =>
          [
            a.name,
            a.otherName,
            a.slug.replace(/-/g, ' '),
            CITY_LABEL[a.city].en,
            CITY_LABEL[a.city].hi,
          ].some((s) => s.toLowerCase().includes(needle)),
        )
        .slice(0, MAX_SUGGESTIONS)
        .map((a) => ({
          placeId: `mock:${a.slug}`,
          label: a.name,
          secondary: CITY_LABEL[a.city][locale],
        }));
    },
    async details(placeId, { locale }) {
      if (!placeId.startsWith('mock:')) return null;
      const area = (await find(locale)).find((a) => `mock:${a.slug}` === placeId);
      return area ? { label: area.name, location: area.centroid } : null;
    },
  };
}

const GOOGLE = 'https://places.googleapis.com/v1';

/** Google Places API (New), restricted to the NCR rectangle and India. */
export function googlePlacesProvider(opts: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): PlacesProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeout = () => AbortSignal.timeout(opts.timeoutMs ?? 3_000);
  /**
   * One Places request. Only `notFound` statuses mean "no such place"; anything else that is not
   * a 2xx (400 for a bad or restricted key, 403, 429, 5xx) or not JSON is the vendor failing, so
   * it is reported, never shown to users as "no results".
   */
  const call = async (url: string, init: RequestInit, notFound: number[] = []) => {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: timeout() });
    } catch (err) {
      throw new PlacesUnavailable(`places unreachable: ${(err as Error).name}`);
    }
    if (notFound.includes(res.status)) return null;
    if (!res.ok) throw new PlacesUnavailable(`places answered ${res.status}`);
    const body: unknown = await res.json().catch(() => undefined);
    if (body === undefined) throw new PlacesUnavailable('places answered with no JSON');
    return body;
  };
  const b = LIMITS.ncrBounds;
  return {
    name: 'google',
    async autocomplete(q, { sessionToken, locale }) {
      const body = (await call(`${GOOGLE}/places:autocomplete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': opts.apiKey },
        body: JSON.stringify({
          input: q,
          sessionToken,
          languageCode: locale,
          includedRegionCodes: ['in'],
          locationRestriction: {
            rectangle: {
              low: { latitude: b.minLat, longitude: b.minLng },
              high: { latitude: b.maxLat, longitude: b.maxLng },
            },
          },
        }),
      })) as {
        suggestions?: {
          placePrediction?: {
            placeId?: string;
            text?: { text?: string };
            structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
          };
        }[];
      } | null;
      return (body?.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
        .slice(0, MAX_SUGGESTIONS)
        .map((p) => ({
          placeId: p.placeId!,
          label: p.structuredFormat?.mainText?.text ?? p.text?.text ?? p.placeId!,
          secondary: p.structuredFormat?.secondaryText?.text ?? null,
        }));
    },
    async details(placeId, { sessionToken, locale }) {
      const params = new URLSearchParams({ languageCode: locale, sessionToken });
      // The location only (Place Details "Essentials"): the name comes from the suggestion.
      const body = (await call(
        `${GOOGLE}/places/${encodeURIComponent(placeId)}?${params.toString()}`,
        { headers: { 'X-Goog-Api-Key': opts.apiKey, 'X-Goog-FieldMask': 'location' } },
        [404],
      )) as { location?: { latitude?: number; longitude?: number } } | null;
      if (!body) return null;
      const lat = body.location?.latitude;
      const lng = body.location?.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number')
        throw new PlacesUnavailable('places answered without a location');
      return { label: null, location: { lat, lng } };
    },
  };
}
