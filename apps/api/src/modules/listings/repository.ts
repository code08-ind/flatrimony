/**
 * Listings in Postgres (docs/04 §6.4, §15.6; docs/05 §8.6). The database holds the rules: the
 * owner must have a room, the public point is computed from the pin, brokerage is 0, and a listing
 * entering review or going live must be complete (a deferred trigger, so the error surfaces at
 * commit). This module maps those errors to ListingError and never selects whole rows: a listing
 * row holds the exact pin and the encrypted address (lint rule `database`).
 */
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@flatrimony/db-types';
import {
  LISTING_LIMITS,
  trueMonthlyPerPersonInr,
  type CreateListingRequest,
  type ListingCosts,
  type ListingMissing,
  type ListingPatch,
  type ListingRules,
  type OwnerListing,
} from '@flatrimony/shared';
import type { Database } from '../../lib/db.js';
import type { FieldCipher } from '../../lib/field-crypto.js';

/** A rule of the database the request broke (mapped to an API error by the routes). */
export class ListingError extends Error {
  constructor(
    readonly reason:
      'incomplete' | 'not_have_room' | 'area' | 'flatmates' | 'location' | 'available_from',
    readonly detail?: string,
  ) {
    super(reason);
    this.name = 'ListingError';
  }
}

export interface OwnerState {
  intent: 'have_room' | 'need_room' | 'pair_up';
  isIdentityVerified: boolean;
  deleted: boolean;
  suspended: boolean;
}

/** Status changes an owner can make (docs/05 §8.6). */
export type ListingAction = 'submit' | 'confirm' | 'pause' | 'resume' | 'remove';

/** Outcome of a write: done, the listing is not the caller's (or gone), or If-Match failed. */
export type WriteResult = 'ok' | 'not_found' | 'stale' | 'wrong_status';

export interface ListingRepository {
  ownerState(userId: string): Promise<OwnerState | null>;
  /** True when the area exists and is active (ref.areas). */
  areaIsActive(areaId: number): Promise<boolean>;
  create(userId: string, input: CreateListingRequest): Promise<string>;
  /** Listings the user created in the last `windowMs`, deleted ones included. */
  createdSince(userId: string, windowMs: number): Promise<number>;
  /**
   * The caller's listing (not deleted), with its ETag version and where its media files are (the
   * routes sign view URLs; `url` is null here); null otherwise.
   */
  get(userId: string, id: string): Promise<Loaded | null>;
  /** The caller's listings, newest first (at most 50: an owner lists a room, rarely a few). */
  listMine(userId: string): Promise<Loaded[]>;
  patch(userId: string, id: string, patch: ListingPatch, ifVersion?: string): Promise<WriteResult>;
  putRules(
    userId: string,
    id: string,
    rules: ListingRules,
    ifVersion?: string,
  ): Promise<WriteResult>;
  putCosts(
    userId: string,
    id: string,
    costs: ListingCosts,
    ifVersion?: string,
  ): Promise<WriteResult>;
  act(userId: string, id: string, action: ListingAction): Promise<WriteResult>;
  /** Puts a processed photo at `position`, replacing (and returning) the one there. */
  putPhoto(
    userId: string,
    id: string,
    photo: PhotoWrite,
    ifVersion?: string,
  ): Promise<MediaWriteResult>;
  /** Sets the walkthrough video, replacing (and returning) the previous one. */
  putVideo(
    userId: string,
    id: string,
    video: VideoWrite,
    ifVersion?: string,
  ): Promise<MediaWriteResult>;
  /** Removes one photo or the video; returns its file. */
  deleteMedia(
    userId: string,
    id: string,
    mediaId: string,
    ifVersion?: string,
  ): Promise<MediaWriteResult>;
  /** Every media file of the caller's listing (to delete them with the listing). */
  mediaFiles(userId: string, id: string): Promise<MediaFile[]>;
}

/** Where a media file is stored. */
export interface MediaFile {
  id: string;
  kind: 'photo' | 'walkthrough_video';
  bucket: string;
  key: string;
}

export interface Loaded {
  listing: OwnerListing;
  version: string;
  files: MediaFile[];
}

export interface PhotoWrite {
  key: string;
  position: number;
  sha256: Buffer;
  /** 64 characters of 0/1. */
  phash: string;
  width: number;
  height: number;
}

export interface VideoWrite {
  key: string;
  sha256: Buffer;
  durationS: number;
  width: number | null;
  height: number | null;
  capturedAt: string;
  integrityVerdict: 'meets_device_integrity' | 'meets_basic_integrity' | 'failed' | 'unverified';
}

/** A media write: done (with the file it replaced or removed), or why not. */
export type MediaWriteResult =
  { result: 'ok'; replaced: MediaFile | null } | { result: Exclude<WriteResult, 'ok'> };

const toFile = (r: {
  id: string;
  kind: 'photo' | 'walkthrough_video';
  storage_bucket: string;
  storage_key: string;
}): MediaFile => ({ id: r.id, kind: r.kind, bucket: r.storage_bucket, key: r.storage_key });

const VERSION_SQL = sql<string>`(extract(epoch from l.updated_at) * 1000000)::bigint::text`;
const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());

/** Which statuses each action starts from, and where it goes. */
const TRANSITIONS: Record<ListingAction, { from: readonly string[]; to: string }> = {
  submit: { from: ['draft'], to: 'active' },
  confirm: { from: ['active', 'expired'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused', 'expired'], to: 'active' },
  // Includes a listing a moderator removed: its owner can still delete it.
  remove: {
    from: ['draft', 'pending_review', 'active', 'paused', 'expired', 'removed'],
    to: 'removed',
  },
};

/** Postgres errors that are the request's fault. */
function fromDbError(err: unknown): ListingError | null {
  const e = err as { code?: string; constraint?: string; message?: string; detail?: string } | null;
  if (!e?.code) return null;
  if (e.code === '23514' && e.message === 'listing_incomplete')
    return new ListingError('incomplete', e.detail);
  if (e.code === '23514' && e.message === 'listing_owner_not_have_room')
    return new ListingError('not_have_room');
  if (e.code === '23503' && e.constraint === 'listings_area_id_fkey')
    return new ListingError('area');
  if (e.code === '23514' && e.constraint === 'listings_flatmates_chk')
    return new ListingError('flatmates');
  if (e.code === '23514' && e.constraint === 'listings_location_ncr_chk')
    return new ListingError('location');
  if (e.code === '23514' && e.constraint === 'listings_available_from_chk')
    return new ListingError('available_from');
  return null;
}

async function mapped<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    throw fromDbError(err) ?? err;
  }
}

const point = ({ lat, lng }: { lat: number; lng: number }) =>
  sql<string>`extensions.st_setsrid(extensions.st_makepoint(${lng}, ${lat}), 4326)::extensions.geography`;

export function pgListingRepository(
  db: Database,
  deps: { cipher: FieldCipher },
): ListingRepository {
  const { cipher } = deps;
  /** The address is bound to its listing (AES-GCM additional data): a copied value fails. */
  const seal = (address: string | null | undefined, id: string) =>
    address === null || address === undefined ? null : cipher.encrypt(address, id);

  /** Locks the caller's live listing row; false when it is not theirs, gone or changed. */
  async function lock(
    tx: Transaction<DB>,
    userId: string,
    id: string,
    ifVersion?: string,
  ): Promise<WriteResult> {
    const row = await tx
      .selectFrom('listings as l')
      .select(['l.status', VERSION_SQL.as('version')])
      .where('l.id', '=', id)
      .where('l.owner_id', '=', userId)
      .where('l.deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row) return 'not_found';
    if (ifVersion !== undefined && row.version !== ifVersion) return 'stale';
    // Taken down by a moderator: the owner sees it but cannot edit it (appeals are T6).
    if (row.status === 'removed') return 'wrong_status';
    return 'ok';
  }

  /** Any change to a part changes the listing's ETag (the trigger sets updated_at). */
  const touch = (tx: Transaction<DB>, id: string) =>
    tx
      .updateTable('listings')
      .set({ updated_at: sql`now()` })
      .where('id', '=', id)
      .execute();

  async function load(userId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await db
      .selectFrom('listings as l')
      .innerJoin('profiles as p', 'p.id', 'l.owner_id')
      .select([
        'l.id',
        'l.status',
        'l.title',
        'l.description',
        'l.area_id',
        sql<number>`extensions.st_y(l.location_exact::extensions.geometry)`.as('lat'),
        sql<number>`extensions.st_x(l.location_exact::extensions.geometry)`.as('lng'),
        sql<number>`extensions.st_y(l.location_public::extensions.geometry)`.as('public_lat'),
        sql<number>`extensions.st_x(l.location_public::extensions.geometry)`.as('public_lng'),
        'l.address_enc',
        'l.bhk',
        'l.room_type',
        'l.furnishing',
        'l.available_from',
        'l.min_lease_months',
        'l.total_flatmates',
        'l.current_flatmates',
        'l.rent_per_person_inr',
        'l.deposit_per_person_inr',
        'l.offers_video_tour',
        'l.last_confirmed_at',
        'l.expires_at',
        'l.published_at',
        'l.created_at',
        'l.updated_at',
        VERSION_SQL.as('version'),
        'p.is_identity_verified',
      ])
      .where('l.id', 'in', ids)
      .where('l.owner_id', '=', userId)
      .where('l.deleted_at', 'is', null)
      .orderBy('l.created_at', 'desc')
      .execute();
    if (rows.length === 0) return [];
    const found = rows.map((r) => r.id);
    const [rules, costs, media] = await Promise.all([
      db
        .selectFrom('listing_rules')
        .select([
          'listing_id',
          'bachelors_allowed',
          'food_rule',
          'guests_rule',
          'pets_allowed',
          'smoking_allowed',
          'gender_rule',
        ])
        .where('listing_id', 'in', found)
        .execute(),
      db
        .selectFrom('listing_costs')
        .select([
          'listing_id',
          'maintenance_inr',
          'electricity_estimate_inr',
          'wifi_inr',
          'help_inr',
          'other_recurring_inr',
          'one_time_costs',
        ])
        .where('listing_id', 'in', found)
        .execute(),
      db
        .selectFrom('listing_media')
        .select([
          'id',
          'listing_id',
          'kind',
          'position',
          'duration_s',
          'moderation_status',
          'storage_bucket',
          'storage_key',
        ])
        .where('listing_id', 'in', found)
        .orderBy('kind')
        .orderBy('position')
        .execute(),
    ]);
    return rows.map((r) => {
      const ru = rules.find((x) => x.listing_id === r.id);
      const co = costs.find((x) => x.listing_id === r.id);
      const md = media.filter((x) => x.listing_id === r.id);
      const listingCosts: ListingCosts | null = co
        ? {
            maintenanceInr: co.maintenance_inr,
            electricityEstimateInr: co.electricity_estimate_inr,
            wifiInr: co.wifi_inr,
            helpInr: co.help_inr,
            otherRecurringInr: co.other_recurring_inr,
            oneTimeCosts: (co.one_time_costs as { label: string; amount_inr: number }[]).map(
              (c) => ({ label: c.label, amountInr: c.amount_inr }),
            ),
          }
        : null;
      const live = md.filter((m) => m.moderation_status !== 'rejected');
      const missing: ListingMissing[] = [];
      if (!ru) missing.push('rules');
      if (!co) missing.push('costs');
      if (live.filter((m) => m.kind === 'photo').length < LISTING_LIMITS.photosMin)
        missing.push('photos');
      if (live.filter((m) => m.kind === 'walkthrough_video').length !== 1) missing.push('video');
      if (!r.is_identity_verified) missing.push('verification');
      const listing: OwnerListing = {
        id: r.id,
        status: r.status,
        title: r.title,
        description: r.description,
        areaId: r.area_id,
        location: { lat: Number(r.lat), lng: Number(r.lng) },
        approxLocation: { lat: Number(r.public_lat), lng: Number(r.public_lng) },
        address: r.address_enc ? cipher.decrypt(r.address_enc, r.id) : null,
        bhk: r.bhk,
        roomType: r.room_type,
        furnishing: r.furnishing,
        availableFrom: r.available_from,
        minLeaseMonths: r.min_lease_months,
        totalFlatmates: r.total_flatmates,
        currentFlatmates: r.current_flatmates,
        rentPerPersonInr: r.rent_per_person_inr,
        depositPerPersonInr: r.deposit_per_person_inr,
        offersVideoTour: r.offers_video_tour,
        rules: ru
          ? {
              bachelorsAllowed: ru.bachelors_allowed,
              foodRule: ru.food_rule,
              guestsRule: ru.guests_rule,
              petsAllowed: ru.pets_allowed,
              smokingAllowed: ru.smoking_allowed,
              genderRule: ru.gender_rule,
            }
          : null,
        costs: listingCosts,
        trueMonthlyPerPersonInr: listingCosts
          ? trueMonthlyPerPersonInr(r.rent_per_person_inr, listingCosts)
          : null,
        media: md.map((m) => ({
          id: m.id,
          kind: m.kind,
          position: m.position,
          durationS: m.duration_s,
          moderationStatus: m.moderation_status,
          url: null,
        })),
        missing,
        lastConfirmedAt: iso(r.last_confirmed_at),
        expiresAt: iso(r.expires_at),
        publishedAt: iso(r.published_at),
        createdAt: iso(r.created_at)!,
        updatedAt: iso(r.updated_at)!,
      };
      const files: MediaFile[] = md.map((m) => ({
        id: m.id,
        kind: m.kind,
        bucket: m.storage_bucket,
        key: m.storage_key,
      }));
      return { listing, version: r.version, files };
    });
  }

  return {
    async ownerState(userId) {
      const row = await db
        .selectFrom('profiles')
        .select([
          'intent',
          'is_identity_verified',
          'deleted_at',
          sql<boolean>`coalesce(suspended_until > now(), false)`.as('suspended'),
        ])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!row) return null;
      return {
        intent: row.intent,
        isIdentityVerified: row.is_identity_verified,
        deleted: row.deleted_at !== null,
        suspended: row.suspended,
      };
    },

    async areaIsActive(areaId) {
      const row = await db
        .selectFrom('ref.areas')
        .select('id')
        .where('id', '=', areaId)
        .where('is_active', '=', true)
        .executeTakeFirst();
      return row !== undefined;
    },

    async create(userId, input) {
      const id = randomUUID();
      await mapped(
        db
          .insertInto('listings')
          .values({
            id,
            owner_id: userId,
            title: input.title,
            description: input.description ?? null,
            area_id: input.areaId,
            location_exact: point(input.location),
            address_enc: seal(input.address, id),
            bhk: input.bhk,
            room_type: input.roomType,
            furnishing: input.furnishing,
            available_from: input.availableFrom,
            min_lease_months: input.minLeaseMonths,
            total_flatmates: input.totalFlatmates,
            current_flatmates: input.currentFlatmates,
            rent_per_person_inr: input.rentPerPersonInr,
            deposit_per_person_inr: input.depositPerPersonInr,
            offers_video_tour: input.offersVideoTour,
          })
          .execute(),
      );
      return id;
    },

    async createdSince(userId, windowMs) {
      const row = await db
        .selectFrom('listings')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('owner_id', '=', userId)
        .where('created_at', '>', sql<Date>`now() - make_interval(secs => ${windowMs / 1000})`)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async get(userId, id) {
      return (await load(userId, [id]))[0] ?? null;
    },

    async listMine(userId) {
      const ids = await db
        .selectFrom('listings')
        .select('id')
        .where('owner_id', '=', userId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute();
      return await load(
        userId,
        ids.map((r) => r.id),
      );
    },

    async patch(userId, id, patch, ifVersion) {
      return mapped(
        db.transaction().execute(async (tx) => {
          const locked = await lock(tx, userId, id, ifVersion);
          if (locked !== 'ok') return locked;
          await tx
            .updateTable('listings')
            .set({
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.description !== undefined ? { description: patch.description } : {}),
              ...(patch.areaId !== undefined ? { area_id: patch.areaId } : {}),
              ...(patch.location !== undefined ? { location_exact: point(patch.location) } : {}),
              ...(patch.address !== undefined ? { address_enc: seal(patch.address, id) } : {}),
              ...(patch.bhk !== undefined ? { bhk: patch.bhk } : {}),
              ...(patch.roomType !== undefined ? { room_type: patch.roomType } : {}),
              ...(patch.furnishing !== undefined ? { furnishing: patch.furnishing } : {}),
              ...(patch.availableFrom !== undefined ? { available_from: patch.availableFrom } : {}),
              ...(patch.minLeaseMonths !== undefined
                ? { min_lease_months: patch.minLeaseMonths }
                : {}),
              ...(patch.totalFlatmates !== undefined
                ? { total_flatmates: patch.totalFlatmates }
                : {}),
              ...(patch.currentFlatmates !== undefined
                ? { current_flatmates: patch.currentFlatmates }
                : {}),
              ...(patch.rentPerPersonInr !== undefined
                ? { rent_per_person_inr: patch.rentPerPersonInr }
                : {}),
              ...(patch.depositPerPersonInr !== undefined
                ? { deposit_per_person_inr: patch.depositPerPersonInr }
                : {}),
              ...(patch.offersVideoTour !== undefined
                ? { offers_video_tour: patch.offersVideoTour }
                : {}),
            })
            .where('id', '=', id)
            .execute();
          return 'ok' as const;
        }),
      );
    },

    async putRules(userId, id, rules, ifVersion) {
      return mapped(
        db.transaction().execute(async (tx) => {
          const locked = await lock(tx, userId, id, ifVersion);
          if (locked !== 'ok') return locked;
          const row = {
            bachelors_allowed: rules.bachelorsAllowed,
            food_rule: rules.foodRule,
            guests_rule: rules.guestsRule,
            pets_allowed: rules.petsAllowed,
            smoking_allowed: rules.smokingAllowed,
            gender_rule: rules.genderRule,
          };
          await tx
            .insertInto('listing_rules')
            .values({ listing_id: id, ...row })
            .onConflict((oc) => oc.column('listing_id').doUpdateSet(row))
            .execute();
          await touch(tx, id);
          return 'ok' as const;
        }),
      );
    },

    async putCosts(userId, id, costs, ifVersion) {
      return mapped(
        db.transaction().execute(async (tx) => {
          const locked = await lock(tx, userId, id, ifVersion);
          if (locked !== 'ok') return locked;
          const row = {
            maintenance_inr: costs.maintenanceInr,
            electricity_estimate_inr: costs.electricityEstimateInr,
            wifi_inr: costs.wifiInr,
            help_inr: costs.helpInr,
            other_recurring_inr: costs.otherRecurringInr,
            one_time_costs: JSON.stringify(
              costs.oneTimeCosts.map((c) => ({ label: c.label, amount_inr: c.amountInr })),
            ),
          };
          await tx
            .insertInto('listing_costs')
            .values({ listing_id: id, ...row })
            .onConflict((oc) => oc.column('listing_id').doUpdateSet(row))
            .execute();
          await touch(tx, id);
          return 'ok' as const;
        }),
      );
    },

    async act(userId, id, action) {
      const { from, to } = TRANSITIONS[action];
      return mapped(
        db.transaction().execute(async (tx) => {
          const row = await tx
            .selectFrom('listings')
            .select(['status'])
            .where('id', '=', id)
            .where('owner_id', '=', userId)
            .where('deleted_at', 'is', null)
            .forUpdate()
            .executeTakeFirst();
          if (!row) return 'not_found' as const;
          if (!from.includes(row.status)) return 'wrong_status' as const;
          const days = LISTING_LIMITS.confirmDays;
          await tx
            .updateTable('listings')
            .set(
              to === 'active'
                ? {
                    status: 'active',
                    published_at: sql`coalesce(published_at, now())`,
                    last_confirmed_at: sql`now()`,
                    expires_at: sql`now() + make_interval(days => ${days})`,
                  }
                : to === 'removed'
                  ? { status: 'removed', deleted_at: sql`now()` }
                  : { status: 'paused' },
            )
            .where('id', '=', id)
            .execute();
          return 'ok' as const;
        }),
      );
    },
    async putPhoto(userId, id, photo, ifVersion) {
      return mapped(
        db.transaction().execute(async (tx): Promise<MediaWriteResult> => {
          const locked = await lock(tx, userId, id, ifVersion);
          if (locked !== 'ok') return { result: locked };
          const old = await tx
            .deleteFrom('listing_media')
            .where('listing_id', '=', id)
            .where('kind', '=', 'photo')
            .where('position', '=', photo.position)
            .returning(['id', 'kind', 'storage_bucket', 'storage_key'])
            .executeTakeFirst();
          await tx
            .insertInto('listing_media')
            .values({
              listing_id: id,
              kind: 'photo',
              storage_bucket: 'listing-photos',
              storage_key: photo.key,
              sha256: photo.sha256,
              phash: photo.phash,
              width: photo.width,
              height: photo.height,
              position: photo.position,
            })
            .execute();
          await touch(tx, id);
          return { result: 'ok', replaced: old ? toFile(old) : null };
        }),
      );
    },

    async putVideo(userId, id, video, ifVersion) {
      return mapped(
        db.transaction().execute(async (tx): Promise<MediaWriteResult> => {
          const locked = await lock(tx, userId, id, ifVersion);
          if (locked !== 'ok') return { result: locked };
          const old = await tx
            .deleteFrom('listing_media')
            .where('listing_id', '=', id)
            .where('kind', '=', 'walkthrough_video')
            .returning(['id', 'kind', 'storage_bucket', 'storage_key'])
            .executeTakeFirst();
          await tx
            .insertInto('listing_media')
            .values({
              listing_id: id,
              kind: 'walkthrough_video',
              storage_bucket: 'r2-walkthroughs',
              storage_key: video.key,
              sha256: video.sha256,
              duration_s: video.durationS,
              width: video.width,
              height: video.height,
              recorded_in_app: true,
              captured_at: video.capturedAt,
              integrity_verdict: video.integrityVerdict,
              position: 0,
            })
            .execute();
          await touch(tx, id);
          return { result: 'ok', replaced: old ? toFile(old) : null };
        }),
      );
    },

    async deleteMedia(userId, id, mediaId, ifVersion) {
      return mapped(
        db.transaction().execute(async (tx): Promise<MediaWriteResult> => {
          const locked = await lock(tx, userId, id, ifVersion);
          if (locked !== 'ok') return { result: locked };
          const gone = await tx
            .deleteFrom('listing_media')
            .where('id', '=', mediaId)
            .where('listing_id', '=', id)
            .returning(['id', 'kind', 'storage_bucket', 'storage_key'])
            .executeTakeFirst();
          if (!gone) return { result: 'not_found' };
          await touch(tx, id);
          return { result: 'ok', replaced: toFile(gone) };
        }),
      );
    },

    async mediaFiles(userId, id) {
      const rows = await db
        .selectFrom('listing_media as m')
        .innerJoin('listings as l', 'l.id', 'm.listing_id')
        .select(['m.id', 'm.kind', 'm.storage_bucket', 'm.storage_key'])
        .where('l.id', '=', id)
        .where('l.owner_id', '=', userId)
        .execute();
      return rows.map(toFile);
    },
  };
}
