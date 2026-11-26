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
 *   DELETE /v1/listings/:id                      soft delete (its files are deleted)         204
 *   POST   /v1/listings/:id/media/upload-url     where to PUT a photo or the walkthrough video
 *   POST   /v1/listings/:id/media                confirm an upload (photos are re-encoded)   201
 *   DELETE /v1/listings/:id/media/:mediaId       remove a photo or the video                 204
 *
 * Every response is the owner's view (exact pin and address included, media with 1-hour links);
 * others' views come with discovery. The automatic listing checks are T3.8. A suspended owner can
 * still read, pause and delete.
 *
 * Photos (docs/04 §8.4): uploaded to `<listing>/uploads/<uuid>` in the private `listing-photos`
 * bucket, then decoded, re-encoded as WebP (EXIF/GPS removed) and stored as `<listing>/<uuid>.webp`,
 * as profile photos (T2.10). The walkthrough video (FR-LST-05): recorded in the Android app,
 * uploaded to R2 under `uploads/<listing>/`, then checked (size, SHA-256, MP4 duration, capture time
 * within 24 h, Play Integrity verdict bound to the file's hash) and moved to `<listing>/<uuid>.mp4`.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateListingRequest,
  ListingCosts,
  ListingMediaConfirmRequest,
  ListingMediaUploadUrlRequest,
  ListingMediaUploadUrlResponse,
  VIDEO_MAX_BYTES,
  ListingPatch,
  ListingRules,
  OwnerListing,
  OwnerListingList,
  mentionsBrokerage,
  RATE_LIMITS,
  type FieldError,
  type ListingMissing,
} from '@flatrimony/shared';
import { ImageError, processPhoto, withImageSlot } from '../../lib/image.js';
import {
  IntegrityUnavailable,
  walkthroughRequestHash,
  type IntegrityVerifier,
} from '../../lib/integrity.js';
import { UPLOAD_URL_TTL_SECONDS, type PhotoStorage } from '../../lib/photo-storage.js';
import {
  mp4Header,
  sha256,
  VIDEO_UPLOAD_TTL_SECONDS,
  VideoStorageUnavailable,
  VideoTooLarge,
  type VideoStorage,
} from '../../lib/video-storage.js';
import { ApiError } from '../../plugins/errors.js';
import { etagFor, parseIfMatch } from '../me/routes.js';
import {
  ListingError,
  type ListingAction,
  type ListingRepository,
  type Loaded,
  type MediaFile,
  type WriteResult,
} from './repository.js';

export interface ListingRoutesOptions {
  repo: ListingRepository;
  /** The `listing-photos` bucket (Supabase Storage). Without it photo uploads answer 503. */
  photos?: PhotoStorage;
  /** Walkthrough videos (R2). Without it video uploads answer 503. */
  videos?: VideoStorage;
  integrity: IntegrityVerifier;
  now?: () => number;
}

const IMAGE_ERROR_MESSAGE: Record<ImageError['reason'], string> = {
  unsupported_format: 'Use a JPEG or WebP photo',
  not_an_image: 'This file is not a photo we can read',
  animated: 'Use a still photo, not an animation',
  too_large: 'Use a photo up to 8 MB and 50 megapixels',
};

// Upload keys: fixed patterns, then the listing id compared as a string (no regex built from input).
const PHOTO_UPLOAD_KEY = /^([0-9a-f-]{36})[/]uploads[/]([0-9a-f-]{36})$/;
const VIDEO_UPLOAD_KEY = /^uploads[/]([0-9a-f-]{36})[/]([0-9a-f-]{36})[.]mp4$/;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUploadKey = (pattern: RegExp, key: string, listingId: string) => {
  const m = pattern.exec(key);
  return !!m && m[1] === listingId && UUID_ONLY.test(m[2]!);
};
/** The app's duration and the file's may differ by rounding and container padding. */
const DURATION_TOLERANCE_S = 2;
/** A walkthrough must be recent: recorded in the last 24 hours (docs/05 §8.6). */
const CAPTURE_MAX_AGE_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
/** The app's capture time and the file's own may differ by the recording's length and clocks. */
const CAPTURE_TOLERANCE_MS = 10 * 60_000;

/** At most two walkthrough videos are checked at a time per API instance (memory). */
let videoSlots = 0;
const videoQueue: (() => void)[] = [];
async function withVideoSlot<T>(work: () => Promise<T>): Promise<T> {
  if (videoSlots >= 2) await new Promise<void>((resolve) => videoQueue.push(resolve));
  videoSlots += 1;
  try {
    return await work();
  } finally {
    videoSlots -= 1;
    videoQueue.shift()?.();
  }
}

const videoInvalid = (message: string, code = 'invalid') =>
  new ApiError('listing.video_invalid', {
    title: 'The walkthrough video cannot be used',
    detail: message,
    errors: [{ path: 'body', code, message }],
  });
const integrityFailed = () =>
  new ApiError('integrity.failed', {
    title: 'Record the walkthrough in the Flatrimony Android app',
    detail: 'We could not confirm the video was recorded in the app on this phone.',
  });
const storageDown = () =>
  new ApiError('upstream.unavailable', {
    title: 'Uploads are not available',
    detail: 'Try again in a moment.',
  });

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
  const now = opts.now ?? Date.now;

  /** Fills in 1-hour view links; a storage hiccup leaves `url` null rather than failing the read. */
  async function withUrls(items: Loaded[], log: FastifyBaseLogger) {
    const files = items.flatMap((i) => i.files);
    const urls = new Map<string, string>();
    const sign = async (
      store: PhotoStorage | VideoStorage | undefined,
      kind: MediaFile['kind'],
    ) => {
      const keys = files.filter((f) => f.kind === kind).map((f) => f.key);
      if (!store || keys.length === 0) return;
      try {
        for (const [k, u] of await store.signedUrls(keys)) urls.set(k, u);
      } catch (err) {
        log.warn({ err: (err as Error).name }, 'listing media links failed');
      }
    };
    await Promise.all([sign(opts.photos, 'photo'), sign(opts.videos, 'walkthrough_video')]);
    return items.map((i) => {
      const keyOf = new Map(i.files.map((f) => [f.id, f.key]));
      return {
        ...i.listing,
        media: i.listing.media.map((m) => ({ ...m, url: urls.get(keyOf.get(m.id) ?? '') ?? null })),
      };
    });
  }

  /** Deletes stored files; a failure is logged, never shown (the row is already gone). */
  async function removeFiles(files: MediaFile[], log: FastifyBaseLogger) {
    const photos = files.filter((f) => f.kind === 'photo').map((f) => f.key);
    const videos = files.filter((f) => f.kind === 'walkthrough_video').map((f) => f.key);
    await Promise.all([
      photos.length && opts.photos ? opts.photos.remove(photos) : null,
      videos.length && opts.videos ? opts.videos.remove(videos) : null,
    ]).catch((err: unknown) =>
      log.warn({ err: (err as Error).name }, 'listing media cleanup failed'),
    );
  }

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
    return (await withUrls([found], reply.log))[0]!;
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
      return { listings: await withUrls(await repo.listMine(req.user!.id), req.log) };
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
      if (req.body.areaId !== undefined && !(await repo.areaIsActive(req.body.areaId)))
        throw invalid([{ path: 'body.areaId', code: 'invalid', message: 'Unknown area' }]);
      try {
        settle(await repo.patch(userId, req.params.listingId, req.body, v));
      } catch (err) {
        fromListingError(err);
      }
      // Content edits on a live listing re-ran the automatic checks in the same transaction.
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
          // Going live, the automatic checks decide between `active` and the moderation queue
          // (`pending_review`; FR-LST-08), inside the same transaction (repository.ts).
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
      const id = req.params.listingId;
      const files = await repo.mediaFiles(userId, id);
      settle(await repo.act(userId, id, 'remove'), 'be deleted');
      // Photos of someone's home are not kept once the listing is deleted (the rows stay with the
      // removed listing for the record; their files do not).
      await removeFiles(files, req.log);
      if (opts.videos)
        await opts.videos
          .list(`uploads/${id}/`)
          .then((staged) => opts.videos!.remove(staged))
          .catch((err: unknown) =>
            req.log.warn({ err: (err as Error).name }, 'listing upload cleanup failed'),
          );
      if (opts.photos)
        await opts.photos
          .list(`${id}/uploads`)
          .then((staged) => opts.photos!.remove(staged.map((o) => o.key)))
          .catch((err: unknown) =>
            req.log.warn({ err: (err as Error).name }, 'listing upload cleanup failed'),
          );
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------ media (T3.6)
  /** The caller's listing, still editable (not removed by a moderator). */
  async function editable(userId: string, id: string, ifVersion?: string) {
    const found = await repo.get(userId, id);
    if (!found) throw notFound();
    if (ifVersion !== undefined && ifVersion !== found.version) settle('stale');
    if (found.listing.status === 'removed') settle('wrong_status', 'be changed');
    return found;
  }

  /** Walkthroughs come from the Android app's recorder only (FR-LST-05; web finishes on Android). */
  function androidOnly(platform: string | string[] | undefined) {
    if (platform !== 'android') throw integrityFailed();
  }

  const mediaLimit = (bucket: string) => ({
    rateLimit: {
      bucket,
      limit: RATE_LIMITS.uploadUrls.limit,
      windowMs: RATE_LIMITS.uploadUrls.windowMs,
    },
  });

  app.post(
    '/listings/:listingId/media/upload-url',
    {
      onRequest: app.requireUser,
      config: mediaLimit('listing_media_upload_urls'),
      schema: {
        params: Params,
        body: ListingMediaUploadUrlRequest,
        response: { 200: ListingMediaUploadUrlResponse },
      },
    },
    async (req) => {
      const userId = req.user!.id;
      await owner(userId, { write: true });
      const id = req.params.listingId;
      await editable(userId, id);
      try {
        if (req.body.kind === 'photo') {
          const store = opts.photos;
          if (!store) throw storageDown();
          // Originals still carry EXIF/GPS: drop this listing's uploads that were never confirmed.
          const cutoff = now() - UPLOAD_URL_TTL_SECONDS * 1000;
          await store
            .list(`${id}/uploads`)
            .then((all) => store.remove(all.filter((o) => o.createdAt < cutoff).map((o) => o.key)))
            .catch((err: unknown) =>
              req.log.warn({ err: (err as Error).name }, 'upload sweep failed'),
            );
          const storageKey = `${id}/uploads/${randomUUID()}`;
          return {
            uploadUrl: await store.createUploadUrl(storageKey),
            storageKey,
            expiresAt: new Date(now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
          };
        }
        androidOnly(req.headers['x-app-platform']);
        if (!opts.videos) throw storageDown();
        const storageKey = `uploads/${id}/${randomUUID()}.mp4`;
        return {
          uploadUrl: await opts.videos.createUploadUrl(storageKey, req.body.sizeBytes),
          storageKey,
          expiresAt: new Date(now() + VIDEO_UPLOAD_TTL_SECONDS * 1000).toISOString(),
        };
      } catch (err) {
        if (err instanceof VideoStorageUnavailable) throw storageDown();
        throw err;
      }
    },
  );

  app.post(
    '/listings/:listingId/media',
    {
      onRequest: app.requireUser,
      config: mediaLimit('listing_media_confirms'),
      schema: { params: Params, body: ListingMediaConfirmRequest, response: { 201: OwnerListing } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      await owner(userId, { write: true });
      const id = req.params.listingId;
      const v = ifMatch(req.headers['if-match']);
      await editable(userId, id, v);
      const body = req.body;
      let replaced: MediaFile | null;

      if (body.kind === 'photo') {
        const store = opts.photos;
        if (!store) throw storageDown();
        if (!isUploadKey(PHOTO_UPLOAD_KEY, body.storageKey, id))
          throw invalid([
            {
              path: 'body.storageKey',
              code: 'invalid_key',
              message: 'Use the key from upload-url',
            },
          ]);
        const original = await store.download(body.storageKey);
        if (!original)
          throw invalid([
            { path: 'body.storageKey', code: 'upload_missing', message: 'Upload the file first' },
          ]);
        // The original (EXIF, GPS of the flat) is gone whatever happens next.
        await store
          .remove([body.storageKey])
          .catch((err: unknown) =>
            req.log.warn({ err: (err as Error).name }, 'photo cleanup failed'),
          );
        let processed;
        try {
          processed = await withImageSlot(() => processPhoto(original));
        } catch (err) {
          if (err instanceof ImageError)
            throw invalid([
              {
                path: 'body.storageKey',
                code: err.reason,
                message: IMAGE_ERROR_MESSAGE[err.reason],
              },
            ]);
          throw err;
        }
        const key = `${id}/${randomUUID()}.webp`;
        await store.upload(key, processed.webp, 'image/webp');
        try {
          const saved = await repo.putPhoto(
            userId,
            id,
            {
              key,
              position: body.position,
              sha256: sha256(processed.webp),
              phash: processed.phash,
              width: processed.width,
              height: processed.height,
            },
            v,
          );
          if (saved.result !== 'ok') settle(saved.result, 'be changed');
          replaced = saved.result === 'ok' ? saved.replaced : null;
        } catch (err) {
          await store.remove([key]).catch(() => {});
          throw err;
        }
      } else {
        const store = opts.videos;
        if (!store) throw storageDown();
        if (!isUploadKey(VIDEO_UPLOAD_KEY, body.storageKey, id))
          throw invalid([
            {
              path: 'body.storageKey',
              code: 'invalid_key',
              message: 'Use the key from upload-url',
            },
          ]);
        // Every refusal from here on deletes the upload: nothing unchecked is kept.
        const refuse = async (err: ApiError) => {
          await store.remove([body.storageKey]).catch(() => {});
          return err;
        };
        if (req.headers['x-app-platform'] !== 'android') throw await refuse(integrityFailed());
        const captured = Date.parse(body.capturedAt);
        const recent = (t: number) => t <= now() + CLOCK_SKEW_MS && t >= now() - CAPTURE_MAX_AGE_MS;
        if (!recent(captured))
          throw await refuse(
            videoInvalid('Record the walkthrough again: it must be from the last 24 hours.', 'old'),
          );
        try {
          // At most two videos are read at a time per instance (each up to 25 MB in memory).
          const checked = await withVideoSlot(async () => {
            const size = await store.size(body.storageKey);
            if (size === null)
              throw invalid([
                {
                  path: 'body.storageKey',
                  code: 'upload_missing',
                  message: 'Upload the file first',
                },
              ]);
            if (size > VIDEO_MAX_BYTES)
              throw await refuse(videoInvalid('The video is larger than 25 MB.', 'too_large'));
            let file: Buffer | null;
            try {
              file = await store.download(body.storageKey, VIDEO_MAX_BYTES);
            } catch (err) {
              if (err instanceof VideoTooLarge)
                throw await refuse(videoInvalid('The video is larger than 25 MB.', 'too_large'));
              throw err;
            }
            if (!file)
              throw invalid([
                {
                  path: 'body.storageKey',
                  code: 'upload_missing',
                  message: 'Upload the file first',
                },
              ]);
            const hash = sha256(file);
            if (hash.toString('hex') !== body.sha256)
              throw await refuse(
                videoInvalid('The uploaded file is not the one recorded.', 'hash_mismatch'),
              );
            const header = mp4Header(file);
            if (!header)
              throw await refuse(videoInvalid('The file is not an MP4 video.', 'not_mp4'));
            // The file decides, not the app: its own length and, when the recorder wrote it, its
            // own creation time (a fresh capturedAt on an old gallery file does not pass).
            const length = header.durationS;
            if (
              Math.abs(length - body.durationS) > DURATION_TOLERANCE_S ||
              // 30 to 90 s as the app shows it (whole seconds), whatever the tolerance above.
              Math.round(length) < 30 ||
              Math.round(length) > 90
            )
              throw await refuse(
                videoInvalid('Walkthroughs are 30 to 90 seconds long.', 'duration'),
              );
            if (
              header.createdAt !== null &&
              (!recent(header.createdAt) ||
                Math.abs(header.createdAt - captured) > CAPTURE_TOLERANCE_MS)
            )
              throw await refuse(
                videoInvalid(
                  'Record the walkthrough again: it must be from the last 24 hours.',
                  'old',
                ),
              );
            return { hash, durationS: Math.min(90, Math.max(30, Math.round(length))) };
          });
          let verdict;
          try {
            // Bound to this upload (its key names the listing), not only to the file.
            verdict = await opts.integrity.verify(
              body.integrityToken,
              walkthroughRequestHash(body.storageKey, body.sha256),
            );
          } catch (err) {
            if (err instanceof IntegrityUnavailable) {
              req.log.warn({ err: err.message }, 'integrity check unavailable');
              throw storageDown();
            }
            throw err;
          }
          // Only a genuine app on a genuine device (founder decision pending on basic integrity).
          if (verdict !== 'meets_device_integrity') {
            req.log.info({ verdict: verdict ?? 'invalid' }, 'walkthrough integrity refused');
            throw await refuse(integrityFailed());
          }
          const key = `${id}/${randomUUID()}.mp4`;
          await store.copy(body.storageKey, key);
          await store.remove([body.storageKey]).catch(() => {});
          try {
            const saved = await repo.putVideo(
              userId,
              id,
              {
                key,
                sha256: checked.hash,
                durationS: checked.durationS,
                width: body.width ?? null,
                height: body.height ?? null,
                capturedAt: new Date(captured).toISOString(),
                integrityVerdict: verdict,
              },
              v,
            );
            if (saved.result !== 'ok') settle(saved.result, 'be changed');
            replaced = saved.result === 'ok' ? saved.replaced : null;
          } catch (err) {
            await store.remove([key]).catch(() => {});
            throw err;
          }
        } catch (err) {
          if (err instanceof VideoStorageUnavailable) throw storageDown();
          throw err;
        }
      }

      if (replaced) await removeFiles([replaced], req.log);
      reply.code(201).header('location', `/v1/listings/${id}`);
      return current(userId, id, reply);
    },
  );

  app.delete(
    '/listings/:listingId/media/:mediaId',
    {
      onRequest: app.requireUser,
      schema: { params: Params.extend({ mediaId: z.uuid() }) },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      await owner(userId, { write: true });
      const id = req.params.listingId;
      const v = ifMatch(req.headers['if-match']);
      await editable(userId, id, v);
      let gone;
      try {
        gone = await repo.deleteMedia(userId, id, req.params.mediaId, v);
      } catch (err) {
        // A live listing keeps 3 photos and its video: add another first, or pause it.
        if (err instanceof ListingError && err.reason === 'incomplete')
          throw new ApiError('listing.incomplete', {
            title: 'A live listing needs its photos and video',
            detail: 'Add another first, or pause the listing to change them.',
          });
        throw err;
      }
      if (gone.result === 'not_found')
        throw new ApiError('not_found', { title: 'Photo or video not found' });
      if (gone.result !== 'ok') settle(gone.result, 'be changed');
      if (gone.result === 'ok' && gone.replaced) await removeFiles([gone.replaced], req.log);
      const after = await repo.get(userId, id);
      if (after) reply.header('etag', etagFor(after.version));
      return reply.code(204).send();
    },
  );
};
