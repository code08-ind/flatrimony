/**
 * Listings for their owner (FR-LST-01..09; docs/05 §8.6):
 *   POST   /v1/listings                          a new draft (have_room members only)        201
 *   GET    /v1/me/listings                       the caller's listings, newest first
 *   GET    /v1/listings/:id                      the caller's listing (ETag)
 *   PATCH  /v1/listings/:id                      change fields (optional If-Match)
 *   PUT    /v1/listings/:id/rules | /costs       replace the house rules / the costs
 *   POST   /v1/listings/:id/submit               complete + DigiLocker-verified owner → live
 *   POST   /v1/listings/:id/confirm-available    still available: live for 7 more days
 *   POST   /v1/listings/:id/pause | /resume      out of discovery / back (re-confirms)
 *   DELETE /v1/listings/:id                      soft delete                                 204
 *
 * Every response is the owner's view (exact pin and address included); others' views come with
 * discovery. Uploading and removing media is T3.6 (removing must also delete the stored file); the
 * automatic listing checks are T3.8. A suspended owner can still read, pause and delete.
 */
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateListingRequest,
  ListingCosts,
  ListingPatch,
  ListingRules,
  OwnerListing,
  OwnerListingList,
  mentionsBrokerage,
  RATE_LIMITS,
  type FieldError,
  type ListingMissing,
} from '@flatrimony/shared';
import { ApiError } from '../../plugins/errors.js';
import { etagFor, parseIfMatch } from '../me/routes.js';
import {
  ListingError,
  type ListingAction,
  type ListingRepository,
  type WriteResult,
} from './repository.js';

export interface ListingRoutesOptions {
  repo: ListingRepository;
}

const invalid = (errors: FieldError[]) =>
  new ApiError('validation.failed', { title: 'Validation failed', errors });

const MISSING_MESSAGE: Record<ListingMissing, string> = {
  rules: 'Add the house rules',
  costs: 'Add the monthly and one-time costs',
  photos: 'Add at least 3 photos',
  video: 'Record the walkthrough video in the app',
  verification: 'Verify your identity with DigiLocker',
};

const incomplete = (missing: string[]) =>
  new ApiError('listing.incomplete', {
    title: 'The listing is not complete',
    errors: missing.map((m) => ({
      path: `listing.${m}`,
      code: 'missing',
      message: MISSING_MESSAGE[m as ListingMissing] ?? 'Missing',
    })),
  });

const notFound = () => new ApiError('not_found', { title: 'Listing not found' });

/** A database rule the request broke, as an API error. */
function fromListingError(err: unknown): never {
  if (!(err instanceof ListingError)) throw err;
  switch (err.reason) {
    case 'incomplete':
      if (err.detail === 'owner')
        throw new ApiError('verification.required', {
          title: 'Verify your identity first',
          detail: 'Listings need an owner verified with DigiLocker who has a room.',
        });
      throw incomplete([err.detail ?? 'listing']);
    case 'not_have_room':
      throw new ApiError('listing.not_allowed_for_intent', {
        title: 'Only members with a room can list one',
      });
    case 'area':
      throw invalid([{ path: 'body.areaId', code: 'invalid', message: 'Unknown area' }]);
    case 'flatmates':
      throw invalid([
        {
          path: 'body.currentFlatmates',
          code: 'invalid',
          message: 'Fewer people live there now than the flat holds',
        },
      ]);
    case 'location':
      throw invalid([
        { path: 'body.location', code: 'invalid', message: 'Pick a place in Delhi NCR' },
      ]);
    case 'available_from':
      throw invalid([{ path: 'body.availableFrom', code: 'invalid', message: 'Invalid date' }]);
    default:
      throw err;
  }
}

const Params = z.object({ listingId: z.uuid() });

export const listingRoutes: FastifyPluginAsyncZod<ListingRoutesOptions> = async (app, opts) => {
  const { repo } = opts;

  /** The caller may use listings: has a profile, not deleted; writes also not suspended. */
  async function owner(userId: string, { write }: { write: boolean }) {
    const state = await repo.ownerState(userId);
    if (!state) throw new ApiError('profile.incomplete', { title: 'Create your profile first' });
    if (state.deleted) throw new ApiError('auth.account_deleted', { title: 'Account deleted' });
    if (write && state.suspended)
      throw new ApiError('account.suspended', { title: 'Account suspended' });
    return state;
  }

  function ifMatch(header: string | string[] | undefined): string | undefined {
    const v = parseIfMatch(typeof header === 'string' ? header : undefined);
    if (v === null)
      throw invalid([
        {
          path: 'headers.if-match',
          code: 'invalid',
          message: 'Use the ETag from GET /v1/listings/{id}',
        },
      ]);
    return v;
  }

  /** Answers with the listing as it is now, and its ETag. */
  async function current(userId: string, id: string, reply: FastifyReply) {
    const found = await repo.get(userId, id);
    if (!found) throw notFound();
    reply.header('etag', etagFor(found.version));
    return found.listing;
  }

  function settle(result: WriteResult, action?: string) {
    if (result === 'not_found') throw notFound();
    if (result === 'stale')
      throw new ApiError('precondition.failed', {
        title: 'Listing changed',
        detail: 'The listing was changed elsewhere. Reload it and try again.',
      });
    if (result === 'wrong_status')
      throw new ApiError('conflict', {
        title: `This listing cannot ${action ?? 'do that'} now`,
      });
  }

  app.post(
    '/listings',
    {
      onRequest: app.requireUser,
      schema: { body: CreateListingRequest, response: { 201: OwnerListing } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      const state = await owner(userId, { write: true });
      // FR-LST-01: a person living in the flat lists their room; no landlords or brokers.
      if (state.intent !== 'have_room')
        throw new ApiError('listing.not_allowed_for_intent', {
          title: 'Only members with a room can list one',
        });
      if (!(await repo.areaIsActive(req.body.areaId)))
        throw invalid([{ path: 'body.areaId', code: 'invalid', message: 'Unknown area' }]);
      // Drafts actually created count, so a refused request never uses up the day's allowance.
      const { limit, windowMs } = RATE_LIMITS.listingCreate;
      if ((await repo.createdSince(userId, windowMs)) >= limit)
        throw new ApiError('rate_limited', {
          title: 'Too many new listings today',
          detail: `You can start up to ${limit} listings a day.`,
        });
      let id: string;
      try {
        id = await repo.create(userId, req.body);
      } catch (err) {
        fromListingError(err);
      }
      reply.code(201).header('location', `/v1/listings/${id}`);
      return current(userId, id, reply);
    },
  );

  app.get(
    '/me/listings',
    { onRequest: app.requireUser, schema: { response: { 200: OwnerListingList } } },
    async (req) => {
      await owner(req.user!.id, { write: false });
      return { listings: await repo.listMine(req.user!.id) };
    },
  );

  app.get(
    '/listings/:listingId',
    { onRequest: app.requireUser, schema: { params: Params, response: { 200: OwnerListing } } },
    async (req, reply) => {
      await owner(req.user!.id, { write: false });
      // Others' view (ListingSummary, the women-only rule) arrives with discovery: until then a
      // listing that is not the caller's is not found.
      return current(req.user!.id, req.params.listingId, reply);
    },
  );

  app.patch(
    '/listings/:listingId',
    {
      onRequest: app.requireUser,
      schema: { params: Params, body: ListingPatch, response: { 200: OwnerListing } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      await owner(userId, { write: true });
      const v = ifMatch(req.headers['if-match']);
      // TODO(T3.8): content edits on a live listing re-run the automatic checks (docs/05 §8.6).
      if (req.body.areaId !== undefined && !(await repo.areaIsActive(req.body.areaId)))
        throw invalid([{ path: 'body.areaId', code: 'invalid', message: 'Unknown area' }]);
      try {
        settle(await repo.patch(userId, req.params.listingId, req.body, v));
      } catch (err) {
        fromListingError(err);
      }
      return current(userId, req.params.listingId, reply);
    },
  );

  app.put(
    '/listings/:listingId/rules',
    {
      onRequest: app.requireUser,
      schema: { params: Params, body: ListingRules, response: { 200: OwnerListing } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      await owner(userId, { write: true });
      const v = ifMatch(req.headers['if-match']);
      settle(await repo.putRules(userId, req.params.listingId, req.body, v));
      return current(userId, req.params.listingId, reply);
    },
  );

  app.put(
    '/listings/:listingId/costs',
    {
      onRequest: app.requireUser,
      schema: { params: Params, body: ListingCosts, response: { 200: OwnerListing } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      await owner(userId, { write: true });
      const v = ifMatch(req.headers['if-match']);
      // Broker-free (FR-LST-03): no one-time cost may be a broker's or agent's fee.
      const broker = req.body.oneTimeCosts.flatMap((c, i) =>
        mentionsBrokerage(c.label)
          ? [{ path: `body.oneTimeCosts.${i}.label`, code: 'brokerage', message: 'No brokerage' }]
          : [],
      );
      if (broker.length > 0)
        throw new ApiError('listing.brokerage_not_allowed', {
          title: 'Flatrimony is broker-free',
          detail: 'Brokerage, agent and commission fees are not allowed.',
          errors: broker,
        });
      settle(await repo.putCosts(userId, req.params.listingId, req.body, v));
      return current(userId, req.params.listingId, reply);
    },
  );

  /** A status change; submit and going live again need a complete listing and a verified owner. */
  const transition = (action: ListingAction, verb: string) =>
    app.post(
      `/listings/:listingId/${action === 'confirm' ? 'confirm-available' : action}`,
      { onRequest: app.requireUser, schema: { params: Params, response: { 200: OwnerListing } } },
      async (req, reply) => {
        const userId = req.user!.id;
        const id = req.params.listingId;
        // A suspended owner can still take their room out of view.
        const state = await owner(userId, { write: action !== 'pause' });
        if (action !== 'pause') {
          // Not the caller's: 404 before anything about their own account.
          const found = await repo.get(userId, id);
          if (!found) throw notFound();
          if (state.intent !== 'have_room')
            throw new ApiError('listing.not_allowed_for_intent', {
              title: 'Only members with a room can list one',
            });
          if (!state.isIdentityVerified)
            throw new ApiError('verification.required', {
              title: 'Verify your identity first',
              detail: 'Listings need an owner verified with DigiLocker.',
            });
          // Going live: say everything that is missing at once (the database names only one).
          const missing = found.listing.missing.filter((m) => m !== 'verification');
          const from: Record<string, string[]> = {
            submit: ['draft'],
            confirm: ['expired'],
            resume: ['paused', 'expired'],
          };
          if (from[action]?.includes(found.listing.status) && missing.length > 0)
            throw incomplete(missing);
        }
        try {
          settle(await repo.act(userId, id, action), verb);
        } catch (err) {
          fromListingError(err);
        }
        return current(userId, id, reply);
      },
    );
  transition('submit', 'be submitted');
  transition('confirm', 'be confirmed');
  transition('pause', 'be paused');
  transition('resume', 'be resumed');

  app.delete(
    '/listings/:listingId',
    { onRequest: app.requireUser, schema: { params: Params } },
    async (req, reply) => {
      const userId = req.user!.id;
      await owner(userId, { write: false }); // suspended owners may delete their listing
      settle(await repo.act(userId, req.params.listingId, 'remove'), 'be deleted');
      return reply.code(204).send();
    },
  );
};
