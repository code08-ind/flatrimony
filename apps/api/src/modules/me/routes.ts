/**
 * /v1/me (docs/05 §8.2, §8.15; T2.5):
 *   POST   /me/bootstrap          create the profile on first login (idempotent), record consents,
 *                                 register the device. 201 when created, 200 when it existed.
 *   GET    /me                    the caller's Me object
 *   PATCH  /me                    display name, bio, languages, locale, intent, category,
 *                                 college fields, isPaused
 *   PUT    /me/preferences, /me/anchor, /me/lifestyle, /me/importance, /me/scenario-answers
 *                                 replace one part of the Flat Biodata (T2.7)
 *   GET    /me/consents           grants (history) + the versions current now
 *   POST   /me/consents           grant { purpose, version } (must be the current version)
 *   DELETE /me/consents/:purpose  withdraw an optional consent (Terms/Privacy: account deletion)
 *
 * Every route needs an OTP session. Phone numbers and device ids are HMAC'd here and never logged.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ageOn,
  Anchor,
  BootstrapRequest,
  ImportanceMap,
  Lifestyle,
  Preferences,
  ScenarioAnswersRequest,
  ConsentGrant,
  ConsentPurpose,
  ConsentRecord,
  ConsentsResponse,
  LIMITS,
  Me,
  MePatch,
  Photo,
  PhotoConfirmRequest,
  PhotoOrderRequest,
  PhotoUploadUrlRequest,
  PhotoUploadUrlResponse,
  RATE_LIMITS,
  REQUIRED_CONSENTS,
  type FieldError,
} from '@flatrimony/shared';
import { ApiError } from '../../plugins/errors.js';
import type { IdentifierHasher } from '../../lib/hashing.js';
import type { BansRepository } from '../auth/bans.js';
import { BANNED_MESSAGE } from '../auth/otp-guard.js';
import { ImageError, processPhoto, withImageSlot } from '../../lib/image.js';
import { UPLOAD_URL_TTL_SECONDS, type PhotoStorage } from '../../lib/photo-storage.js';
import type { LegalVersions, MeRepository, ProfileState, ProfileUpdate } from './repository.js';

export interface MeRoutesOptions {
  repo: MeRepository;
  bans: BansRepository;
  hasher: IdentifierHasher;
  /** Profile photo storage (T2.10). Without it the photo routes answer 503 and Me has no photos. */
  photos?: PhotoStorage;
  now?: () => number;
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
/** Today's date in India (YYYY-MM-DD): ages and the 18+ rule follow the user's calendar. */
export const istToday = (nowMs: number) =>
  new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);

const safeHash = (hasher: IdentifierHasher, phone: string): Buffer | null => {
  try {
    return hasher('phone', phone);
  } catch {
    return null;
  }
};

const IMAGE_ERROR_MESSAGE: Record<ImageError['reason'], string> = {
  unsupported_format: 'Use a JPEG or WebP photo',
  not_an_image: 'This file is not a photo we can read',
  animated: 'Use a still photo, not an animation',
  too_large: 'Use a photo up to 8 MB and 50 megapixels',
};

const invalid = (errors: FieldError[]) =>
  new ApiError('validation.failed', { title: 'Validation failed', errors });

/** Postgres constraint errors that are the user's input, mapped to catalogue codes. */
function fromDbError(err: unknown): ApiError | null {
  const e = err as { code?: string; constraint?: string } | null;
  if (e?.code === '23514' && e.constraint === 'profiles_adult_chk')
    return new ApiError('profile.underage', { title: 'You must be 18 or older' });
  if (e?.code === '23514' && e.constraint === 'profiles_women_only_chk')
    return new ApiError('profile.category_not_allowed', {
      title: 'Women-only needs a verified female identity',
    });
  if (e?.code === '23514' && (err as Error).message === 'invalid_scenario_option')
    // The trigger's detail is the question id; the scenario route turns it into a field path.
    return Object.assign(
      new ApiError('validation.failed', {
        title: 'Validation failed',
        errors: [
          { path: 'body', code: 'invalid_option', message: 'Not an option of this question' },
        ],
      }),
      { question: (err as { detail?: unknown }).detail },
    );
  if (e?.code === 'P0001' && (err as Error).message === 'limit_exceeded')
    return new ApiError('limit_exceeded', { title: 'Too many items' });
  if (e?.code === '23505' && e.constraint === 'user_contact_phone_hash_key')
    return new ApiError('conflict', {
      title: 'This number belongs to another account',
    });
  return null;
}

const isPhoneHashConflict = (err: unknown) => {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && e.constraint === 'user_contact_phone_hash_key';
};

/** `W/"<version>"` for a profile version; parses either form back (null if absent or malformed). */
export const etagFor = (version: string) => `W/"${version}"`;
export function parseIfMatch(header: string | undefined): string | null | undefined {
  // `*` matches any current representation (RFC 9110 §13.1.1): the profile exists, so no condition.
  if (header === undefined || header.trim() === '*') return undefined;
  const m = /^(?:W\/)?"(\d{1,20})"$/.exec(header.trim());
  return m ? m[1]! : null;
}

async function rethrowDb<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    throw fromDbError(err) ?? err;
  }
}

/** Checks consents against the published versions; returns field errors (empty when fine). */
export function consentErrors(
  grants: { purpose: string; version: string }[],
  current: LegalVersions,
  { requireAll }: { requireAll: boolean },
): FieldError[] {
  const errors: FieldError[] = [];
  if (requireAll) {
    for (const purpose of REQUIRED_CONSENTS) {
      if (!grants.some((g) => g.purpose === purpose))
        errors.push({
          path: 'body.consents',
          code: 'consent_required',
          message: `The ${purpose === 'terms' ? 'Terms' : 'Privacy Policy'} must be accepted`,
        });
    }
  }
  grants.forEach((g, i) => {
    const want = current[g.purpose as keyof LegalVersions];
    if (want === undefined)
      errors.push({
        path: requireAll ? `body.consents.${i}.purpose` : 'body.purpose',
        code: 'consent_not_offered',
        message: 'This consent is not offered yet',
      });
    else if (g.version !== want)
      errors.push({
        path: requireAll ? `body.consents.${i}.version` : 'body.version',
        code: 'consent_version_outdated',
        message: `Accept the current version (${want}); fetch GET /v1/config`,
      });
  });
  return errors;
}

export const meRoutes: FastifyPluginAsyncZod<MeRoutesOptions> = async (app, opts) => {
  const now = opts.now ?? Date.now;
  const { repo } = opts;

  async function currentVersions(): Promise<LegalVersions> {
    const versions = await repo.legalVersions();
    if (!versions || !REQUIRED_CONSENTS.every((p) => versions[p])) {
      // No published Terms/Privacy (founder task T0.15): nobody can consent to them yet.
      throw new ApiError('upstream.unavailable', {
        title: 'Sign-up is not open yet',
        detail: 'The Terms and Privacy Policy are not published yet.',
      });
    }
    return versions;
  }

  /** Moderation suspension (docs/05 §3): reads stay allowed, writes are refused. */
  function assertNotSuspended(state: ProfileState) {
    if (state.suspendedUntil)
      throw new ApiError('account.suspended', {
        title: 'Account suspended',
        suspendedUntil: state.suspendedUntil,
      });
  }

  /** The caller's profile, or the reason they cannot use /me yet. */
  async function liveProfile(userId: string): Promise<ProfileState> {
    const state = await repo.profileState(userId);
    if (!state)
      throw new ApiError('profile.incomplete', {
        title: 'Profile not created',
        detail: 'Call POST /v1/me/bootstrap first.',
      });
    if (state.deleted) throw new ApiError('auth.account_deleted', { title: 'Account deleted' });
    return state;
  }

  async function me(userId: string) {
    const result = await repo.loadMe(userId, istToday(now()));
    if (!result) throw new ApiError('not_found', { title: 'Not found' });
    return { ...result, photos: await signedPhotos(userId) };
  }

  /**
   * The user's photos with 1-hour signed URLs (none without storage). A Storage outage leaves the
   * photos out instead of failing GET /me and every write that answers with Me (review T2.10).
   */
  async function signedPhotos(userId: string): Promise<Me['photos']> {
    if (!opts.photos) return [];
    const rows = await repo.listPhotos(userId);
    let urls: Map<string, string>;
    try {
      urls = await opts.photos.signedUrls(rows.map((r) => r.storagePath));
    } catch (err) {
      app.log.warn({ err: (err as Error).name }, 'photo signing failed');
      return [];
    }
    return rows.flatMap((r) => {
      const url = urls.get(r.storagePath);
      return url
        ? [{ id: r.id, url, position: r.position, moderationStatus: r.moderationStatus }]
        : [];
    });
  }

  app.post(
    '/me/bootstrap',
    {
      onRequest: app.requireUser,
      schema: { body: BootstrapRequest, response: { 200: Me, 201: Me } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      const body = req.body;

      const existing = await repo.profileState(userId);
      if (existing?.deleted)
        throw new ApiError('auth.account_deleted', { title: 'Account deleted' });
      if (existing) assertNotSuspended(existing);

      if (!existing) {
        if (body.dateOfBirth < '1900-01-01')
          throw invalid([
            {
              path: 'body.dateOfBirth',
              code: 'too_small',
              message: 'Enter your real date of birth',
            },
          ]);
        if (ageOn(body.dateOfBirth, istToday(now())) < LIMITS.minAge)
          throw new ApiError('profile.underage', { title: 'You must be 18 or older' });
      }

      const errors = consentErrors(body.consents, await currentVersions(), { requireAll: true });
      if (errors.length > 0) throw invalid(errors);

      // FR-AUTH-08: a banned number or device cannot create (or re-enter) an account. The phone is
      // the one Supabase verified with the OTP, never a value from the request.
      const phone = await repo.phoneOf(userId);
      if (!phone)
        throw new ApiError('conflict', {
          title: 'No verified phone',
          detail: 'Sign in with your phone number first.',
        });
      // Only Indian mobiles can sign in (send-SMS and before-user-created hooks); defence in depth.
      const phoneHash = safeHash(opts.hasher, phone);
      if (!phoneHash) throw new ApiError('conflict', { title: 'Unsupported phone number' });
      const deviceHash = opts.hasher('device', body.device.deviceId);
      if (await opts.bans.isBanned({ phoneHash, deviceHash })) {
        req.log.info({ ban: true }, 'bootstrap: banned identity');
        throw new ApiError('auth.banned', { title: 'Not allowed', detail: BANNED_MESSAGE });
      }

      const write = {
        profile: {
          displayName: body.displayName,
          dateOfBirth: body.dateOfBirth,
          intent: body.intent,
          category: body.category,
          locale: body.locale,
        },
        phoneHash,
        consents: body.consents,
        device: {
          deviceHash,
          platform: body.device.platform,
          appVersion: body.device.appVersion,
          ...(body.device.pushToken ? { pushToken: body.device.pushToken } : {}),
          // Play Integrity is not wired yet (needs the Play Console project, T0.x); the token is
          // accepted and ignored, and the device is recorded as unverified.
          integrityVerdict: 'unverified' as const,
        },
      };
      let created: boolean;
      try {
        ({ created } = await repo.bootstrap(userId, write));
      } catch (err) {
        if (!isPhoneHashConflict(err)) throw fromDbError(err) ?? err;
        // The number is on another account. If that account has since changed its number (and the
        // old one was reassigned to this caller), move its stored hash to its current number.
        const holder = await repo.phoneHashHolder(phoneHash);
        const holderHash = holder?.phone ? safeHash(opts.hasher, holder.phone) : null;
        if (!holder || holderHash?.equals(phoneHash)) throw fromDbError(err)!;
        try {
          await repo.setPhoneHash(holder.userId, holderHash);
        } catch {
          await repo.setPhoneHash(holder.userId, null);
        }
        ({ created } = await rethrowDb(repo.bootstrap(userId, write)));
      }
      if (created) reply.header('location', '/v1/me');
      return reply.status(created ? 201 : 200).send(await me(userId));
    },
  );

  app.get(
    '/me',
    { onRequest: app.requireUser, schema: { response: { 200: Me } } },
    async (req, reply) => {
      const state = await liveProfile(req.user!.id);
      reply.header('etag', etagFor(state.version));
      return me(req.user!.id);
    },
  );

  app.patch(
    '/me',
    { onRequest: app.requireUser, schema: { body: MePatch, response: { 200: Me } } },
    async (req, reply) => {
      const userId = req.user!.id;
      const state = await liveProfile(userId);
      assertNotSuspended(state);
      const patch = req.body;
      if (Object.keys(patch).length === 0)
        throw invalid([{ path: 'body', code: 'empty', message: 'Nothing to change' }]);
      // Optional optimistic concurrency (docs/05 §6.2): If-Match with the ETag from GET /me.
      const ifVersion = parseIfMatch(req.headers['if-match']);
      if (ifVersion === null)
        throw invalid([
          { path: 'headers.if-match', code: 'invalid', message: 'Use the ETag from GET /v1/me' },
        ]);

      // Women-only is for verified women; before verification it is allowed and stays invisible.
      if (
        patch.category === 'women_only' &&
        state.isIdentityVerified &&
        state.verifiedGender !== 'female'
      )
        throw new ApiError('profile.category_not_allowed', {
          title: 'Women-only needs a verified female identity',
        });

      const category = patch.category ?? state.category;
      const update: ProfileUpdate = { ...patch };
      if (category !== 'student') {
        const errors: FieldError[] = [];
        for (const field of ['collegeName', 'courseEndDate'] as const) {
          if (patch[field] != null)
            errors.push({
              path: `body.${field}`,
              code: 'student_only',
              message: 'Only for the student category',
            });
        }
        if (errors.length > 0) throw invalid(errors);
        // Leaving the student category clears the college fields.
        if (patch.category !== undefined && state.category === 'student') {
          update.collegeName = null;
          update.courseEndDate = null;
        }
      }

      const applied = await rethrowDb(repo.updateProfile(userId, update, ifVersion));
      if (!applied)
        throw new ApiError('precondition.failed', {
          title: 'Profile changed',
          detail: 'Your profile was changed elsewhere. Reload it and try again.',
        });
      const after = await repo.profileState(userId);
      if (after) reply.header('etag', etagFor(after.version));
      return me(userId);
    },
  );

  // ------------------------------------------------------------------ biodata (T2.7)
  // Each PUT replaces its part of the Flat Biodata, recomputes completion and returns the new Me
  // with its ETag, so the app can update the completion ring at once. Order of checks: session,
  // profile (409), suspension (403), then the request (422).
  async function writableProfile(req: { user: { id: string } | null }) {
    const userId = req.user!.id;
    assertNotSuspended(await liveProfile(userId));
    return userId;
  }

  /** Runs the write with the optional If-Match and answers with the new Me + ETag. */
  async function biodataWrite(
    req: { user: { id: string } | null; headers: Record<string, string | string[] | undefined> },
    reply: { header(name: string, value: string): unknown },
    userId: string,
    write: (ifVersion: string | undefined) => Promise<boolean>,
  ) {
    const header = req.headers['if-match'];
    const ifVersion = parseIfMatch(typeof header === 'string' ? header : undefined);
    if (ifVersion === null)
      throw invalid([
        { path: 'headers.if-match', code: 'invalid', message: 'Use the ETag from GET /v1/me' },
      ]);
    if (!(await rethrowDb(write(ifVersion))))
      throw new ApiError('precondition.failed', {
        title: 'Profile changed',
        detail: 'Your profile was changed elsewhere. Reload it and try again.',
      });
    const after = await repo.profileState(userId);
    if (after) reply.header('etag', etagFor(after.version));
    return me(userId);
  }

  app.put(
    '/me/preferences',
    { onRequest: app.requireUser, schema: { body: Preferences, response: { 200: Me } } },
    async (req, reply) => {
      const userId = await writableProfile(req);
      const p = req.body;
      const errors: FieldError[] = [];
      const known = new Set(await repo.activeAreaIds(p.areaIds));
      p.areaIds.forEach((id, i) => {
        if (!known.has(id))
          errors.push({ path: `body.areaIds.${i}`, code: 'unknown_area', message: 'Unknown area' });
      });
      if (p.moveInTo < istToday(now()))
        errors.push({
          path: 'body.moveInTo',
          code: 'in_the_past',
          message: 'The move-in window has already ended',
        });
      if (errors.length > 0) throw invalid(errors);
      return biodataWrite(req, reply, userId, (v) => repo.replacePreferences(userId, p, v));
    },
  );

  app.put(
    '/me/anchor',
    { onRequest: app.requireUser, schema: { body: Anchor, response: { 200: Me } } },
    async (req, reply) => {
      const userId = await writableProfile(req);
      const { lat, lng } = req.body.location;
      const b = LIMITS.ncrBounds;
      if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng)
        throw invalid([
          { path: 'body.location', code: 'outside_ncr', message: 'Pick a place in Delhi NCR' },
        ]);
      // commute.compute is enqueued here once the job runner exists (T1.14/T2.9); until then the
      // zone is simply absent and discovery falls back to areas.
      return biodataWrite(req, reply, userId, (v) => repo.setAnchor(userId, req.body, v));
    },
  );

  app.put(
    '/me/lifestyle',
    { onRequest: app.requireUser, schema: { body: Lifestyle, response: { 200: Me } } },
    async (req, reply) => {
      const userId = await writableProfile(req);
      return biodataWrite(req, reply, userId, (v) => repo.replaceLifestyle(userId, req.body, v));
    },
  );

  app.put(
    '/me/importance',
    { onRequest: app.requireUser, schema: { body: ImportanceMap, response: { 200: Me } } },
    async (req, reply) => {
      const userId = await writableProfile(req);
      return biodataWrite(req, reply, userId, (v) => repo.replaceImportance(userId, req.body, v));
    },
  );

  app.put(
    '/me/scenario-answers',
    {
      onRequest: app.requireUser,
      schema: { body: ScenarioAnswersRequest, response: { 200: Me } },
    },
    async (req, reply) => {
      const userId = await writableProfile(req);
      const ids = req.body.map((a) => a.questionId);
      const known = new Set(await repo.activeScenarioQuestionIds(ids));
      const errors: FieldError[] = [];
      ids.forEach((id, i) => {
        if (!known.has(id))
          errors.push({
            path: `body.${i}.questionId`,
            code: 'unknown_question',
            message: 'Unknown question',
          });
      });
      if (errors.length > 0) throw invalid(errors);
      try {
        return await biodataWrite(req, reply, userId, (v) =>
          repo.upsertScenarioAnswers(userId, req.body, v),
        );
      } catch (err) {
        // The trigger names the question whose option is wrong: point at that answer.
        const question = (err as { question?: unknown }).question;
        const i = typeof question === 'string' ? ids.indexOf(question) : -1;
        if (err instanceof ApiError && i >= 0 && err.extra.errors?.[0]?.code === 'invalid_option')
          throw invalid([
            {
              path: `body.${i}.optionId`,
              code: 'invalid_option',
              message: 'Not an option of this question',
            },
          ]);
        throw err;
      }
    },
  );

  // ------------------------------------------------------------------ photos (T2.10)
  // Upload straight to storage with a signed URL, then confirm: the API checks and re-encodes the
  // image (EXIF/GPS removed), stores it as <user>/<uuid>.webp with its perceptual hash and deletes
  // the original. This runs in the request until the job runner exists (media.process, T1.14).
  function storage(): PhotoStorage {
    if (!opts.photos)
      throw new ApiError('upstream.unavailable', { title: 'Photo storage is not configured' });
    return opts.photos;
  }
  const UPLOAD_KEY = /^([0-9a-f-]{36})\/uploads\/([0-9a-f-]{36})$/;

  app.post(
    '/me/photos/upload-url',
    {
      onRequest: app.requireUser,
      config: {
        rateLimit: {
          bucket: 'photo_upload_urls',
          limit: RATE_LIMITS.uploadUrls.limit,
          windowMs: RATE_LIMITS.uploadUrls.windowMs,
        },
      },
      schema: { body: PhotoUploadUrlRequest, response: { 200: PhotoUploadUrlResponse } },
    },
    async (req) => {
      const userId = await writableProfile(req);
      const store = storage();
      // Originals still carry EXIF/GPS: remove this user's uploads that were never confirmed and
      // whose upload URL has expired (until the sweeper job exists, T1.14). Best effort.
      await sweepStaleUploads(store, userId).catch((err: unknown) =>
        req.log.warn({ err: (err as Error).name }, 'upload sweep failed'),
      );
      // The original goes to a per-user staging key; only the processed copy is ever shown.
      const storageKey = `${userId}/uploads/${randomUUID()}`;
      const uploadUrl = await store.createUploadUrl(storageKey);
      return {
        uploadUrl,
        storageKey,
        expiresAt: new Date(now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      };
    },
  );

  async function sweepStaleUploads(store: PhotoStorage, userId: string) {
    const cutoff = now() - UPLOAD_URL_TTL_SECONDS * 1000;
    const stale = (await store.list(`${userId}/uploads`))
      .filter((o) => o.createdAt < cutoff)
      .map((o) => o.key);
    await store.remove(stale);
  }

  app.post(
    '/me/photos',
    {
      onRequest: app.requireUser,
      // Each confirm decodes and re-encodes an image: limited like upload URLs (review T2.10).
      config: {
        rateLimit: {
          bucket: 'photo_confirms',
          limit: RATE_LIMITS.uploadUrls.limit,
          windowMs: RATE_LIMITS.uploadUrls.windowMs,
        },
      },
      schema: { body: PhotoConfirmRequest, response: { 201: Photo } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      const state = await liveProfile(userId);
      assertNotSuspended(state);
      const store = storage();
      const { storageKey, position } = req.body;

      // Every cheap check first, before any download or image work.
      const header = req.headers['if-match'];
      const ifVersion = parseIfMatch(typeof header === 'string' ? header : undefined);
      if (ifVersion === null)
        throw invalid([
          { path: 'headers.if-match', code: 'invalid', message: 'Use the ETag from GET /v1/me' },
        ]);
      if (ifVersion !== undefined && ifVersion !== state.version)
        throw new ApiError('precondition.failed', { title: 'Profile changed' });
      const key = UPLOAD_KEY.exec(storageKey);
      if (!key || key[1] !== userId)
        throw invalid([
          { path: 'body.storageKey', code: 'invalid_key', message: 'Use the key from upload-url' },
        ]);
      // Photos fill positions 0..n-1: replace one, or add at the next free position.
      const count = (await repo.listPhotos(userId)).length;
      if (position > count)
        throw invalid([
          {
            path: 'body.position',
            code: 'position_gap',
            message: `Use a position from 0 to ${count}`,
          },
        ]);

      const original = await store.download(storageKey);
      if (!original)
        throw invalid([
          { path: 'body.storageKey', code: 'upload_missing', message: 'Upload the file first' },
        ]);
      // The original (with its EXIF/GPS) is not kept a moment longer than needed: whatever happens
      // next, it is gone. On a failure the app uploads again.
      await store
        .remove([storageKey])
        .catch((err: unknown) =>
          req.log.warn({ err: (err as Error).name }, 'photo cleanup failed'),
        );

      let processed;
      try {
        processed = await withImageSlot(() => processPhoto(original));
      } catch (err) {
        if (err instanceof ImageError)
          throw invalid([
            { path: 'body.storageKey', code: err.reason, message: IMAGE_ERROR_MESSAGE[err.reason] },
          ]);
        throw err;
      }
      const finalKey = `${userId}/${randomUUID()}.webp`;
      await store.upload(finalKey, processed.webp, 'image/webp');
      let saved: Awaited<ReturnType<MeRepository['addPhoto']>>;
      try {
        saved = await rethrowDb(
          repo.addPhoto(
            userId,
            {
              storagePath: finalKey,
              position,
              width: processed.width,
              height: processed.height,
              phash: processed.phash,
            },
            ifVersion,
          ),
        );
      } catch (err) {
        await store.remove([finalKey]).catch(() => {});
        throw err;
      }
      if (!saved) {
        await store.remove([finalKey]).catch(() => {});
        throw new ApiError('precondition.failed', { title: 'Profile changed' });
      }
      if (saved.replacedPath)
        await store
          .remove([saved.replacedPath])
          .catch((err: unknown) =>
            req.log.warn({ err: (err as Error).name }, 'photo cleanup failed'),
          );
      const after = await repo.profileState(userId);
      if (after) reply.header('etag', etagFor(after.version));
      let url: string | undefined;
      try {
        url = (await store.signedUrls([finalKey])).get(finalKey);
      } catch {
        url = undefined;
      }
      if (!url)
        // Saved, but the link could not be made: the app reloads the profile (GET /v1/me).
        throw new ApiError('upstream.unavailable', {
          title: 'Photo saved',
          detail: 'Your photo was saved. Reload your profile to see it.',
        });
      // The photo is part of the profile (there is no single-photo resource).
      reply.header('location', '/v1/me');
      return reply.status(201).send({
        id: saved.id,
        url,
        position,
        moderationStatus: 'pending' as const,
      });
    },
  );

  app.patch(
    '/me/photos/order',
    { onRequest: app.requireUser, schema: { body: PhotoOrderRequest, response: { 200: Me } } },
    async (req, reply) => {
      const userId = await writableProfile(req);
      storage();
      const header = req.headers['if-match'];
      const ifVersion = parseIfMatch(typeof header === 'string' ? header : undefined);
      if (ifVersion === null)
        throw invalid([
          { path: 'headers.if-match', code: 'invalid', message: 'Use the ETag from GET /v1/me' },
        ]);
      const result = await repo.reorderPhotos(userId, req.body.photoIds, ifVersion);
      if (result === 'stale')
        throw new ApiError('precondition.failed', { title: 'Profile changed' });
      if (result === 'mismatch')
        throw invalid([
          {
            path: 'body.photoIds',
            code: 'mismatch',
            message: 'List each of your photos exactly once',
          },
        ]);
      const after = await repo.profileState(userId);
      if (after) reply.header('etag', etagFor(after.version));
      return me(userId);
    },
  );

  app.delete(
    '/me/photos/:photoId',
    { onRequest: app.requireUser, schema: { params: z.object({ photoId: z.uuid() }) } },
    async (req, reply) => {
      const userId = await writableProfile(req);
      const store = storage();
      const header = req.headers['if-match'];
      const ifVersion = parseIfMatch(typeof header === 'string' ? header : undefined);
      if (ifVersion === null)
        throw invalid([
          { path: 'headers.if-match', code: 'invalid', message: 'Use the ETag from GET /v1/me' },
        ]);
      const result = await repo.deletePhoto(userId, req.params.photoId, ifVersion);
      if (result === 'stale')
        throw new ApiError('precondition.failed', { title: 'Profile changed' });
      if (result === 'not_found') throw new ApiError('not_found', { title: 'Photo not found' });
      if (result === 'last')
        throw new ApiError('conflict', {
          title: 'Keep at least one photo',
          detail: 'Add another photo before removing this one.',
        });
      await store
        .remove([result.storagePath])
        .catch((err: unknown) =>
          req.log.warn({ err: (err as Error).name }, 'photo cleanup failed'),
        );
      // Every photo write changes the profile version (docs/05 §8.3): hand out the new ETag.
      const after = await repo.profileState(userId);
      if (after) reply.header('etag', etagFor(after.version));
      return reply.status(204).send();
    },
  );

  app.get(
    '/me/consents',
    { onRequest: app.requireUser, schema: { response: { 200: ConsentsResponse } } },
    async (req) => {
      await liveProfile(req.user!.id);
      return {
        consents: await repo.listConsents(req.user!.id),
        currentVersions: (await repo.legalVersions()) ?? {},
      };
    },
  );

  app.post(
    '/me/consents',
    {
      onRequest: app.requireUser,
      schema: { body: ConsentGrant, response: { 200: ConsentRecord, 201: ConsentRecord } },
    },
    async (req, reply) => {
      assertNotSuspended(await liveProfile(req.user!.id));
      const errors = consentErrors([req.body], await currentVersions(), { requireAll: false });
      if (errors.length > 0) throw invalid(errors);
      const { record, created } = await repo.grantConsent(req.user!.id, req.body);
      return reply.status(created ? 201 : 200).send(record);
    },
  );

  app.delete(
    '/me/consents/:purpose',
    {
      onRequest: app.requireUser,
      schema: { params: z.object({ purpose: ConsentPurpose }) },
    },
    async (req, reply) => {
      await liveProfile(req.user!.id);
      const { purpose } = req.params;
      if ((REQUIRED_CONSENTS as readonly string[]).includes(purpose))
        throw new ApiError('conflict', {
          title: 'Required consent',
          detail:
            'The Terms and Privacy Policy can only be withdrawn by deleting the account (POST /v1/me/deletion).',
        });
      await repo.withdrawConsent(req.user!.id, purpose);
      return reply.status(204).send();
    },
  );
};
