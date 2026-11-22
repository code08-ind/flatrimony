/**
 * /v1/places (docs/05 §8.5; T2.8):
 *   POST /places/autocomplete   { q, sessionToken } → { suggestions: [{ placeId, label, secondary }] }
 *   GET  /places/:placeId       ?sessionToken= → { placeId, label, location } (inside Delhi NCR)
 * Autocomplete is a POST so the search text stays out of URLs and logs.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  LIMITS,
  PlaceAutocompleteRequest,
  PlaceAutocompleteResponse,
  PlaceDetails,
  RATE_LIMITS,
} from '@flatrimony/shared';
import { ApiError } from '../../plugins/errors.js';
import { PlacesUnavailable, type PlacesProvider } from './provider.js';

export interface PlacesRoutesOptions {
  provider: PlacesProvider;
}

const placesRateLimit = {
  rateLimit: {
    bucket: 'places',
    limit: RATE_LIMITS.places.limit,
    windowMs: RATE_LIMITS.places.windowMs,
  },
};

const localeOf = (header: string | string[] | undefined) =>
  String(header ?? '')
    .toLowerCase()
    .startsWith('hi')
    ? ('hi' as const)
    : ('en' as const);

const unavailable = () =>
  new ApiError('upstream.unavailable', {
    title: 'Place search is not available',
    detail: 'Try again in a moment, or pick areas instead.',
  });

export const placesRoutes: FastifyPluginAsyncZod<PlacesRoutesOptions> = async (app, opts) => {
  const { provider } = opts;

  app.post(
    '/places/autocomplete',
    {
      onRequest: app.requireUser,
      config: placesRateLimit,
      schema: { body: PlaceAutocompleteRequest, response: { 200: PlaceAutocompleteResponse } },
    },
    async (req) => {
      try {
        const suggestions = await provider.autocomplete(req.body.q, {
          sessionToken: req.body.sessionToken,
          locale: localeOf(req.headers['accept-language']),
        });
        return { suggestions };
      } catch (err) {
        if (err instanceof PlacesUnavailable) {
          req.log.warn({ err: err.message }, 'place search failed');
          throw unavailable();
        }
        throw err;
      }
    },
  );

  app.get(
    '/places/:placeId',
    {
      onRequest: app.requireUser,
      config: placesRateLimit,
      schema: {
        params: z.object({ placeId: z.string().regex(/^[A-Za-z0-9_:.-]{1,300}$/) }),
        querystring: z.object({ sessionToken: z.uuid().optional() }).strict(),
        response: { 200: PlaceDetails },
      },
    },
    async (req) => {
      let place: Awaited<ReturnType<PlacesProvider['details']>>;
      try {
        place = await provider.details(req.params.placeId, {
          ...(req.query.sessionToken ? { sessionToken: req.query.sessionToken } : {}),
          locale: localeOf(req.headers['accept-language']),
        });
      } catch (err) {
        if (err instanceof PlacesUnavailable) {
          req.log.warn({ err: err.message }, 'place details failed');
          throw unavailable();
        }
        throw err;
      }
      if (!place) throw new ApiError('not_found', { title: 'Place not found' });
      const { lat, lng } = place.location;
      const b = LIMITS.ncrBounds;
      if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng)
        throw new ApiError('validation.failed', {
          title: 'Validation failed',
          errors: [
            { path: 'params.placeId', code: 'outside_ncr', message: 'Pick a place in Delhi NCR' },
          ],
        });
      return { placeId: req.params.placeId, ...place };
    },
  );
};
