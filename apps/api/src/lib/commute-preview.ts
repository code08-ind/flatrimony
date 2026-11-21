/**
 * Commute zone previews for the anchor picker (FR-BIO-03; docs/05 §8.5): the zone a point, travel
 * mode and time would give, before the user saves it. Routed through the routing service with a
 * short timeout; metro/transit, a point with no road nearby, or routing that is slow or down give
 * the radius approximation (`approx: true`). Results are cached per place (rounded to about 100 m),
 * mode and minutes, so dragging the pin around one spot does not call routing again.
 */
import type { CommutePreviewRequest, CommutePreviewResponse } from '@flatrimony/shared';
import { COSTING, fetchIsochrone, radiusZone, RoutingError } from '@flatrimony/routing';

export interface CommutePreview {
  preview(req: CommutePreviewRequest): Promise<CommutePreviewResponse>;
}

export function createCommutePreview(opts: {
  routingUrl?: string;
  /** A Google ID token for the private routing service (Cloud Run); none locally. */
  token?: (audience: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  /** The picker waits for this, at most. */
  timeoutMs?: number;
  cacheSize?: number;
  cacheTtlMs?: number;
  now?: () => number;
  onRoutingError?: (err: RoutingError) => void;
}): CommutePreview {
  const now = opts.now ?? Date.now;
  const ttl = opts.cacheTtlMs ?? 60 * 60_000;
  const max = opts.cacheSize ?? 1_000;
  const cache = new Map<string, { at: number; value: CommutePreviewResponse }>();

  return {
    async preview(req) {
      const key = [
        req.location.lat.toFixed(3),
        req.location.lng.toFixed(3),
        req.travelMode,
        req.maxCommuteMin,
      ].join('|');
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) return hit.value;

      let value: CommutePreviewResponse | undefined;
      let cacheable = true;
      if (opts.routingUrl && COSTING[req.travelMode]) {
        try {
          const zone = await fetchIsochrone({
            baseUrl: opts.routingUrl,
            location: req.location,
            mode: req.travelMode,
            minutes: req.maxCommuteMin,
            token: opts.token ? await opts.token(opts.routingUrl) : undefined,
            timeoutMs: opts.timeoutMs ?? 4_000,
            fetchImpl: opts.fetchImpl,
          });
          value = { zone, approx: false };
        } catch (err) {
          const e = err instanceof RoutingError ? err : new RoutingError(String(err), true);
          opts.onRoutingError?.(e);
          // A temporary failure is not cached: the next move of the pin may get the routed zone.
          cacheable = !e.retryable;
        }
      }
      value ??= {
        zone: radiusZone(req.location, req.travelMode, req.maxCommuteMin),
        approx: true,
      };
      if (cacheable) {
        if (cache.size >= max) cache.delete(cache.keys().next().value!); // oldest first
        cache.set(key, { at: now(), value });
      }
      return value;
    },
  };
}
