import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { TravelMode } from '../enums.js';
import { LatLng } from '../primitives.js';

/** A GeoJSON position, [lng, lat]. */
const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** A commute zone's shape (GeoJSON MultiPolygon, [lng, lat] order). */
export const GeoMultiPolygon = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(Position).min(4)).min(1)).min(1),
});
export type GeoMultiPolygon = z.infer<typeof GeoMultiPolygon>;

/**
 * `GET /v1/me/commute-zone` (FR-BIO-03; docs/05 §8.2):
 * - `none`: no office or college set (discovery uses areas);
 * - `computing`: no zone fits the anchor yet (it changed, or the zone is being drawn); `zone` is
 *   null or the earlier one;
 * - `ready`: the zone matches the anchor (it stays `ready` while a refresh redraws it).
 * `approx` is true for the radius approximation (metro/transit, or routing unavailable).
 */
export const CommuteZone = z.object({
  status: z.enum(['none', 'computing', 'ready']),
  zone: GeoMultiPolygon.nullable(),
  approx: z.boolean(),
  travelMode: TravelMode.nullable(),
  maxCommuteMin: z.number().int().nullable(),
  computedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type CommuteZone = z.infer<typeof CommuteZone>;

/** `POST /v1/commute/preview`: the zone a point, mode and time would give, before saving it. */
export const CommutePreviewRequest = z
  .object({
    location: LatLng,
    travelMode: TravelMode,
    maxCommuteMin: z
      .number()
      .int()
      .min(LIMITS.commuteMinutes.min)
      .max(LIMITS.commuteMinutes.max)
      .default(LIMITS.commuteMinutes.default),
  })
  .strict();
export type CommutePreviewRequest = z.infer<typeof CommutePreviewRequest>;

export const CommutePreviewResponse = z.object({ zone: GeoMultiPolygon, approx: z.boolean() });
export type CommutePreviewResponse = z.infer<typeof CommutePreviewResponse>;

/**
 * Place search for the office/college picker (FR-BIO-03; docs/05 §8.5). POST, not GET: what a
 * user types (their office) must not end up in URLs and access logs. `sessionToken` groups one
 * search's keystrokes and the final details call (Google Places session billing).
 */
export const PlaceAutocompleteRequest = z
  .object({
    q: z.string().trim().min(2).max(100),
    sessionToken: z.uuid(),
  })
  .strict();
export type PlaceAutocompleteRequest = z.infer<typeof PlaceAutocompleteRequest>;

export const PlaceSuggestion = z.object({
  placeId: z.string().min(1).max(300),
  /** The place's name, e.g. "DLF Cyber City". */
  label: z.string().min(1),
  /** Where it is, e.g. "Gurugram, Haryana". */
  secondary: z.string().nullable(),
});
export type PlaceSuggestion = z.infer<typeof PlaceSuggestion>;

export const PlaceAutocompleteResponse = z.object({
  suggestions: z.array(PlaceSuggestion).max(10),
});
export type PlaceAutocompleteResponse = z.infer<typeof PlaceAutocompleteResponse>;

/** `GET /v1/places/{placeId}?sessionToken=`: the point to use as the anchor (inside NCR). */
export const PlaceDetails = z.object({
  placeId: z.string().min(1),
  label: z.string().min(1).max(LIMITS.anchorLabelMaxChars),
  location: LatLng,
});
export type PlaceDetails = z.infer<typeof PlaceDetails>;
