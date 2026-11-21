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
 * - `computing`: the anchor changed and its zone is being drawn (`zone` may be the earlier one
 *   or an approximation, or null);
 * - `ready`: the zone matches the anchor.
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
