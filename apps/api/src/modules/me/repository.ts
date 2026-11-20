/**
 * Data access for /v1/me (docs/05 §8.2, §8.15). Postgres only: the rules that matter (18+, women-only
 * consistency, unique phone hash, one row per device) are database constraints, so the routes are
 * tested against a real database (test/integration/me.db.test.ts) and against a fake of this
 * interface for HTTP-level behaviour (test/me.test.ts).
 */
import { sql } from 'kysely';
import { z } from 'zod';
import {
  ageOn,
  biodataCompletion,
  ConsentPurpose as ConsentPurposeSchema,
  PolicyVersion,
  type AppLocale,
  type Category,
  type ConsentGrant,
  type ConsentRecord,
  type Anchor,
  type ImportanceMap,
  type Intent,
  type Lifestyle,
  type Me,
  type Preferences,
  type ScenarioAnswersRequest,
  type Platform,
} from '@flatrimony/shared';
import type { ProfilePhotos, VerifiedGender } from '@flatrimony/db-types';
import type { Selectable } from 'kysely';
import type { Database } from '../../lib/db.js';

type ConsentPurpose = ConsentGrant['purpose'];
export type LegalVersions = Partial<Record<ConsentPurpose, string>>;

/** Play Integrity verdicts we store (the token itself never is). */
export type IntegrityVerdict =
  'unverified' | 'meets_device_integrity' | 'meets_basic_integrity' | 'failed';

export interface ProfileState {
  category: Category;
  isIdentityVerified: boolean;
  verifiedGender: VerifiedGender | null;
  deleted: boolean;
  /** ISO time while a moderation suspension is running, else null. */
  suspendedUntil: string | null;
  /** Changes on every profile write (microseconds of updated_at): the ETag. */
  version: string;
}

/** ref.app_config 'legal.versions' as stored; anything malformed counts as unpublished. */
const LegalVersionsSchema = z.partialRecord(ConsentPurposeSchema, PolicyVersion);

export interface BootstrapWrite {
  profile: {
    displayName: string;
    dateOfBirth: string;
    intent: Intent;
    category: Category;
    locale: AppLocale;
  };
  phoneHash: Buffer;
  consents: ConsentGrant[];
  device: {
    deviceHash: Buffer;
    platform: Platform;
    appVersion: string;
    pushToken?: string;
    integrityVerdict: IntegrityVerdict;
  };
}

/** Columns PATCH /me may change (camelCase; `null` clears). */
export interface ProfileUpdate {
  displayName?: string;
  bio?: string | null;
  languages?: string[];
  locale?: AppLocale;
  intent?: Intent;
  category?: Category;
  collegeName?: string | null;
  courseEndDate?: string | null;
  isPaused?: boolean;
}

export interface StoredPhoto {
  id: string;
  storagePath: string;
  position: number;
  moderationStatus: 'pending' | 'approved' | 'rejected';
}

export interface NewPhoto {
  storagePath: string;
  position: number;
  width: number;
  height: number;
  /** 64 chars of 0/1 */
  phash: string;
}

export interface MeRepository {
  /** ref.app_config 'legal.versions'; null when not published yet (T0.15). */
  legalVersions(): Promise<LegalVersions | null>;
  /** The verified phone of the auth user (auth.users.phone), or null. */
  phoneOf(userId: string): Promise<string | null>;
  profileState(userId: string): Promise<ProfileState | null>;
  /** One transaction: profile (if new), phone hash, consents, device. */
  bootstrap(userId: string, write: BootstrapWrite): Promise<{ created: boolean }>;
  /** Who holds this phone hash in private.user_contact, with their current auth phone. */
  phoneHashHolder(phoneHash: Buffer): Promise<{ userId: string; phone: string | null } | null>;
  /** Re-points (or, with null, removes) a user's stored phone hash after a number change. */
  setPhoneHash(userId: string, phoneHash: Buffer | null): Promise<void>;
  loadMe(userId: string, today: string): Promise<Me | null>;
  /** False when `ifVersion` is given and the profile changed since (412). */
  updateProfile(userId: string, update: ProfileUpdate, ifVersion?: string): Promise<boolean>;
  /** The given area ids that exist and are active (ref.areas). */
  activeAreaIds(ids: number[]): Promise<number[]>;
  /** The given scenario question ids that exist and are active. */
  activeScenarioQuestionIds(ids: string[]): Promise<string[]>;
  /**
   * Biodata writes (T2.7). Each replaces its part in one transaction that first locks and touches
   * the profile row (so concurrent writes for one user run one after the other and the ETag always
   * changes), then recomputes completion. False when `ifVersion` is given and is stale (412).
   */
  replacePreferences(
    userId: string,
    preferences: Preferences,
    ifVersion?: string,
  ): Promise<boolean>;
  setAnchor(userId: string, anchor: Anchor, ifVersion?: string): Promise<boolean>;
  replaceLifestyle(userId: string, lifestyle: Lifestyle, ifVersion?: string): Promise<boolean>;
  replaceImportance(
    userId: string,
    importance: ImportanceMap,
    ifVersion?: string,
  ): Promise<boolean>;
  upsertScenarioAnswers(
    userId: string,
    answers: ScenarioAnswersRequest,
    ifVersion?: string,
  ): Promise<boolean>;
  /** Photos (T2.10), in position order. */
  listPhotos(userId: string): Promise<StoredPhoto[]>;
  /**
   * Adds a processed photo at `position`, replacing the one there (its storage path is returned so
   * the object can be removed after commit). null when `ifVersion` is stale.
   */
  addPhoto(
    userId: string,
    photo: NewPhoto,
    ifVersion?: string,
  ): Promise<{ id: string; replacedPath: string | null } | null>;
  /** Puts the user's photos in the given order (positions 0..n-1); the ids must be exactly theirs. */
  reorderPhotos(
    userId: string,
    ids: string[],
    ifVersion?: string,
  ): Promise<'ok' | 'mismatch' | 'stale'>;
  /** Removes one photo and closes the gap; refuses to remove the last one (docs/05 §8.3). */
  deletePhoto(
    userId: string,
    photoId: string,
    ifVersion?: string,
  ): Promise<{ storagePath: string } | 'not_found' | 'last' | 'stale'>;
  listConsents(userId: string): Promise<ConsentRecord[]>;
  /** Records a grant; `created` is false when an identical grant was already active. */
  grantConsent(
    userId: string,
    grant: ConsentGrant,
  ): Promise<{ record: ConsentRecord; created: boolean }>;
  /** Withdraws every active grant of the purpose; false when none was active. */
  withdrawConsent(userId: string, purpose: ConsentPurpose): Promise<boolean>;
}

const iso = (value: Date | string) => new Date(value).toISOString();
const hhmm = (time: string) => time.slice(0, 5);

function consentRecord(row: {
  purpose: ConsentPurpose;
  version: string;
  granted_at: Date | string;
  withdrawn_at: Date | string | null;
}): ConsentRecord {
  return {
    purpose: row.purpose,
    version: row.version,
    grantedAt: iso(row.granted_at),
    ...(row.withdrawn_at ? { withdrawnAt: iso(row.withdrawn_at) } : {}),
  };
}

/** Recomputes profiles.biodata_completion from what is stored (docs/05 §8.2: on every write). */
async function recomputeCompletion(db: Database, userId: string): Promise<void> {
  const row = await sql<{
    basics: boolean;
    preferences: boolean;
    anchor_or_areas: boolean;
    lifestyle: boolean;
    photos: boolean;
    bio: boolean;
    languages: boolean;
    importance: boolean;
    scenarios: boolean;
    identity_verified: boolean;
  }>`
    select
      (p.date_of_birth is not null) as basics,
      exists (select 1 from public.preferences x where x.user_id = p.id) as preferences,
      (exists (select 1 from public.anchors x where x.user_id = p.id)
        or exists (select 1 from public.preference_areas x where x.user_id = p.id)) as anchor_or_areas,
      exists (select 1 from public.lifestyle x where x.user_id = p.id) as lifestyle,
      exists (select 1 from public.profile_photos x where x.user_id = p.id and x.moderation_status <> 'rejected') as photos,
      coalesce(char_length(btrim(p.bio)), 0) > 0 as bio,
      cardinality(p.languages) > 0 as languages,
      exists (select 1 from public.lifestyle_importance x where x.user_id = p.id) as importance,
      exists (select 1 from public.scenario_answers x where x.user_id = p.id) as scenarios,
      p.is_identity_verified as identity_verified
    from public.profiles p where p.id = ${userId}
  `.execute(db);
  const parts = row.rows[0];
  if (!parts) return;
  const value = biodataCompletion({
    basics: parts.basics,
    preferences: parts.preferences,
    anchorOrAreas: parts.anchor_or_areas,
    lifestyle: parts.lifestyle,
    photos: parts.photos,
    bio: parts.bio,
    languages: parts.languages,
    importance: parts.importance,
    scenarios: parts.scenarios,
    identityVerified: parts.identity_verified,
  });
  await db
    .updateTable('profiles')
    .set({ biodata_completion: value })
    .where('id', '=', userId)
    .where('biodata_completion', '<>', value)
    .execute();
}

/**
 * A refused write must not change anything, not even the profile version (ETag) that lockAndTouch
 * bumped (QA T2.10 F1): the outcome is thrown to roll the transaction back, then returned.
 */
class Rollback<T> extends Error {
  constructor(readonly outcome: T) {
    super('rollback');
  }
}
async function withRollbackOn<T, R>(
  db: Database,
  work: (tx: Database) => Promise<T>,
): Promise<T | R> {
  try {
    return await db.transaction().execute(work);
  } catch (err) {
    if (err instanceof Rollback) return err.outcome as R;
    throw err;
  }
}

const VERSION_SQL = sql<string>`(extract(epoch from updated_at) * 1000000)::bigint::text`;

/**
 * Locks the profile row for the rest of the transaction and bumps updated_at (the ETag). With
 * `ifVersion`, only when the profile is still at that version. False when nothing matched.
 */
async function lockAndTouch(tx: Database, userId: string, ifVersion?: string): Promise<boolean> {
  const res = await tx
    .updateTable('profiles')
    .set({ updated_at: sql`now()` })
    .where('id', '=', userId)
    .$if(ifVersion !== undefined, (q) => q.where(VERSION_SQL, '=', ifVersion!))
    .executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}

/** Runs a biodata write after lockAndTouch; recomputes completion; false on a stale version. */
async function biodataTx(
  db: Database,
  userId: string,
  ifVersion: string | undefined,
  write: (tx: Database) => Promise<void>,
): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    if (!(await lockAndTouch(tx, userId, ifVersion))) return false;
    await write(tx);
    await recomputeCompletion(tx, userId);
    return true;
  });
}

/**
 * Gives the photos positions 0..n-1 in the given order. (user_id, position) is unique and not
 * deferrable (docs/04 §6.2), so rows cannot be swapped in place: they are removed and inserted
 * again, keeping ids and every other column.
 */
async function rewritePositions(
  tx: Database,
  userId: string,
  ordered: Selectable<ProfilePhotos>[],
) {
  await tx.deleteFrom('profile_photos').where('user_id', '=', userId).execute();
  if (ordered.length === 0) return;
  // Every column is carried over (a later moderation column must not be wiped by a reorder).
  await tx
    .insertInto('profile_photos')
    .values(ordered.map((r, position) => ({ ...r, position })))
    .execute();
}

export function pgMeRepository(db: Database): MeRepository {
  return {
    async legalVersions() {
      const row = await db
        .selectFrom('ref.app_config')
        .select('value')
        .where('key', '=', 'legal.versions')
        .executeTakeFirst();
      if (!row) return null;
      const parsed = LegalVersionsSchema.safeParse(row.value);
      return parsed.success ? parsed.data : null;
    },

    async phoneOf(userId) {
      const { rows } = await sql<{
        phone: string | null;
      }>`select phone from auth.users where id = ${userId}`.execute(db);
      return rows[0]?.phone || null;
    },

    async profileState(userId) {
      const row = await db
        .selectFrom('profiles')
        .select([
          'category',
          'is_identity_verified',
          'verified_gender',
          'deleted_at',
          sql<string | null>`case when suspended_until > now() then suspended_until end`.as(
            'suspended_until',
          ),
          sql<string>`(extract(epoch from updated_at) * 1000000)::bigint::text`.as('version'),
        ])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!row) return null;
      return {
        category: row.category,
        isIdentityVerified: row.is_identity_verified,
        verifiedGender: row.verified_gender,
        deleted: row.deleted_at !== null,
        suspendedUntil: row.suspended_until ? iso(row.suspended_until) : null,
        version: row.version,
      };
    },

    async bootstrap(userId, write) {
      return db.transaction().execute(async (tx) => {
        const inserted = await tx
          .insertInto('profiles')
          .values({
            id: userId,
            display_name: write.profile.displayName,
            date_of_birth: write.profile.dateOfBirth,
            intent: write.profile.intent,
            category: write.profile.category,
            locale: write.profile.locale,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .returning('id')
          .executeTakeFirst();

        // The verified number's hash (auth.users holds the number). Updated after a phone change.
        await tx
          .insertInto('private.user_contact')
          .values({ user_id: userId, phone_hash: write.phoneHash })
          .onConflict((oc) =>
            oc
              .column('user_id')
              .doUpdateSet({ phone_hash: write.phoneHash })
              .where('private.user_contact.phone_hash', '<>', write.phoneHash),
          )
          .execute();

        for (const grant of write.consents) {
          // Append-only: an already active grant is kept (with its original time).
          await tx
            .insertInto('consents')
            .values({ user_id: userId, purpose: grant.purpose, version: grant.version })
            .onConflict((oc) =>
              oc
                .columns(['user_id', 'purpose', 'version'])
                .where('withdrawn_at', 'is', null)
                .doNothing(),
            )
            .execute();
        }

        const d = write.device;
        // This installation (and its push token) now belongs to this user: other accounts that used
        // it before must not receive this user's notifications, nor this user theirs.
        await tx
          .updateTable('devices')
          .set({ push_token: null })
          .where('user_id', '<>', userId)
          .where((eb) =>
            d.pushToken
              ? eb.or([eb('device_hash', '=', d.deviceHash), eb('push_token', '=', d.pushToken)])
              : eb('device_hash', '=', d.deviceHash),
          )
          .where('push_token', 'is not', null)
          .execute();
        await tx
          .insertInto('devices')
          .values({
            user_id: userId,
            device_hash: d.deviceHash,
            platform: d.platform,
            app_version: d.appVersion,
            push_token: d.pushToken ?? null,
            integrity_verdict: d.integrityVerdict,
          })
          .onConflict((oc) =>
            oc.columns(['user_id', 'device_hash']).doUpdateSet({
              platform: d.platform,
              app_version: d.appVersion,
              push_token: d.pushToken ?? sql`devices.push_token`,
              integrity_verdict: d.integrityVerdict,
              last_seen_at: sql`now()`,
            }),
          )
          .execute();

        if (inserted) await recomputeCompletion(tx, userId);
        return { created: inserted !== undefined };
      });
    },

    async loadMe(userId, today) {
      const p = await db
        .selectFrom('profiles')
        .selectAll()
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!p) return null;

      const [prefs, areas, anchor, life, importance, scenarios] = await Promise.all([
        db.selectFrom('preferences').selectAll().where('user_id', '=', userId).executeTakeFirst(),
        db
          .selectFrom('preference_areas')
          .select('area_id')
          .where('user_id', '=', userId)
          .orderBy('area_id')
          .execute(),
        db
          .selectFrom('anchors')
          .select([
            'kind',
            'label',
            'travel_mode',
            'max_commute_min',
            sql<number>`extensions.st_y(location::extensions.geometry)`.as('lat'),
            sql<number>`extensions.st_x(location::extensions.geometry)`.as('lng'),
          ])
          .where('user_id', '=', userId)
          .executeTakeFirst(),
        db.selectFrom('lifestyle').selectAll().where('user_id', '=', userId).executeTakeFirst(),
        db
          .selectFrom('lifestyle_importance')
          .select(['attribute', 'importance'])
          .where('user_id', '=', userId)
          .execute(),
        db
          .selectFrom('scenario_answers')
          .select(['question_id', 'option_id'])
          .where('user_id', '=', userId)
          .orderBy('question_id')
          .execute(),
      ]);

      const badges: Me['badges'] = [];
      if (p.is_identity_verified) badges.push({ type: 'identity_verified' });
      if (p.verified_gender === 'female') badges.push({ type: 'female_verified' });
      if (p.has_work_badge) badges.push({ type: 'work_verified' });
      if (p.has_college_badge) badges.push({ type: 'student_verified' });

      return {
        id: p.id,
        displayName: p.display_name,
        age: p.date_of_birth ? ageOn(p.date_of_birth, today) : null,
        intent: p.intent,
        category: p.category,
        ...(p.bio ? { bio: p.bio } : {}),
        languages: p.languages,
        locale: p.locale,
        ...(p.college_name ? { collegeName: p.college_name } : {}),
        ...(p.course_end_date ? { courseEndDate: p.course_end_date } : {}),
        isIdentityVerified: p.is_identity_verified,
        badges,
        isPaused: p.is_paused,
        biodataCompletion: p.biodata_completion,
        // Photo URLs are signed per request; uploads and signing arrive with T2.10.
        photos: [],
        ...(prefs
          ? {
              preferences: {
                budgetMinInr: prefs.budget_min_inr,
                budgetMaxInr: prefs.budget_max_inr,
                moveInFrom: prefs.move_in_from,
                moveInTo: prefs.move_in_to,
                leaseMonths: prefs.lease_months,
                flatmateGenderPref: prefs.flatmate_gender_pref,
                areaIds: areas.map((a) => a.area_id),
              },
            }
          : {}),
        ...(anchor
          ? {
              anchor: {
                kind: anchor.kind,
                label: anchor.label,
                location: { lat: Number(anchor.lat), lng: Number(anchor.lng) },
                travelMode: anchor.travel_mode,
                maxCommuteMin: anchor.max_commute_min,
              },
            }
          : {}),
        ...(life
          ? {
              lifestyle: {
                bedtime: hhmm(life.bedtime),
                wakeTime: hhmm(life.wake_time),
                cleaning: life.cleaning,
                smoking: life.smoking,
                pets: life.pets,
                food: life.food,
                ...(life.cooks_at_home !== null ? { cooksAtHome: life.cooks_at_home } : {}),
                ...(life.drinking ? { drinking: life.drinking } : {}),
                ...(life.guests ? { guests: life.guests } : {}),
                ...(life.parties ? { parties: life.parties } : {}),
                ...(life.work_mode ? { workMode: life.work_mode } : {}),
              },
            }
          : {}),
        importance: Object.fromEntries(importance.map((i) => [i.attribute, i.importance])),
        scenarioAnswers: scenarios.map((a) => ({
          questionId: a.question_id,
          optionId: a.option_id,
        })),
        // Move Pass is v1.1 (purchases, migration 0014).
        entitlements: { movePass: { active: false } },
        createdAt: iso(p.created_at),
      };
    },

    async phoneHashHolder(phoneHash) {
      const { rows } = await sql<{ user_id: string; phone: string | null }>`
        select c.user_id, u.phone
        from private.user_contact c left join auth.users u on u.id = c.user_id
        where c.phone_hash = ${phoneHash}`.execute(db);
      const row = rows[0];
      return row ? { userId: row.user_id, phone: row.phone || null } : null;
    },

    async setPhoneHash(userId, phoneHash) {
      if (phoneHash === null) {
        await db.deleteFrom('private.user_contact').where('user_id', '=', userId).execute();
        return;
      }
      await db
        .updateTable('private.user_contact')
        .set({ phone_hash: phoneHash })
        .where('user_id', '=', userId)
        .execute();
    },

    async updateProfile(userId, u, ifVersion) {
      return db.transaction().execute(async (tx) => {
        const res = await tx
          .updateTable('profiles')
          .set({
            ...(u.displayName !== undefined ? { display_name: u.displayName } : {}),
            ...(u.bio !== undefined ? { bio: u.bio || null } : {}),
            ...(u.languages !== undefined ? { languages: u.languages } : {}),
            ...(u.locale !== undefined ? { locale: u.locale } : {}),
            ...(u.intent !== undefined ? { intent: u.intent } : {}),
            ...(u.category !== undefined ? { category: u.category } : {}),
            ...(u.collegeName !== undefined ? { college_name: u.collegeName } : {}),
            ...(u.courseEndDate !== undefined ? { course_end_date: u.courseEndDate } : {}),
            ...(u.isPaused !== undefined ? { is_paused: u.isPaused } : {}),
          })
          .where('id', '=', userId)
          .$if(ifVersion !== undefined, (q) =>
            q.where(
              sql<string>`(extract(epoch from updated_at) * 1000000)::bigint::text`,
              '=',
              ifVersion!,
            ),
          )
          .executeTakeFirst();
        if (Number(res.numUpdatedRows) === 0) return false;
        await recomputeCompletion(tx, userId);
        return true;
      });
    },

    async activeAreaIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .selectFrom('ref.areas')
        .select('id')
        .where('id', 'in', ids)
        .where('is_active', '=', true)
        .execute();
      return rows.map((r) => r.id);
    },

    async activeScenarioQuestionIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .selectFrom('ref.scenario_questions')
        .select('id')
        .where('id', 'in', ids)
        .where('is_active', '=', true)
        .execute();
      return rows.map((r) => r.id);
    },

    async replacePreferences(userId, p, ifVersion) {
      return biodataTx(db, userId, ifVersion, async (tx) => {
        const row = {
          budget_min_inr: p.budgetMinInr,
          budget_max_inr: p.budgetMaxInr,
          move_in_from: p.moveInFrom,
          move_in_to: p.moveInTo,
          lease_months: p.leaseMonths,
          flatmate_gender_pref: p.flatmateGenderPref,
        };
        await tx
          .insertInto('preferences')
          .values({ user_id: userId, ...row })
          .onConflict((oc) => oc.column('user_id').doUpdateSet(row))
          .execute();
        // Replace the area set (at most 3; the enforce_max_rows trigger backs this up).
        await tx.deleteFrom('preference_areas').where('user_id', '=', userId).execute();
        if (p.areaIds.length > 0)
          await tx
            .insertInto('preference_areas')
            .values(p.areaIds.map((areaId) => ({ user_id: userId, area_id: areaId })))
            .execute();
      });
    },

    async setAnchor(userId, a, ifVersion) {
      return biodataTx(db, userId, ifVersion, async (tx) => {
        const row = {
          kind: a.kind,
          label: a.label,
          location: sql<string>`extensions.st_setsrid(extensions.st_makepoint(${a.location.lng}, ${a.location.lat}), 4326)::extensions.geography`,
          travel_mode: a.travelMode,
          max_commute_min: a.maxCommuteMin,
        };
        const before = await tx
          .selectFrom('anchors')
          .select([
            sql<number>`extensions.st_y(location::extensions.geometry)`.as('lat'),
            sql<number>`extensions.st_x(location::extensions.geometry)`.as('lng'),
          ])
          .where('user_id', '=', userId)
          .executeTakeFirst();
        await tx
          .insertInto('anchors')
          .values({ user_id: userId, ...row })
          .onConflict((oc) => oc.column('user_id').doUpdateSet(row))
          .execute();
        // The commute zone depends on the point, travel mode and minutes (not on the label or
        // kind). When any of those changed it no longer matches; commute.compute redraws it (T2.9).
        const moved =
          !before || Number(before.lat) !== a.location.lat || Number(before.lng) !== a.location.lng;
        await tx
          .deleteFrom('commute_zones')
          .where('user_id', '=', userId)
          .$if(!moved, (q) =>
            q.where((eb) =>
              eb.or([
                eb('travel_mode', '<>', a.travelMode),
                eb('max_minutes', '<>', a.maxCommuteMin),
              ]),
            ),
          )
          .execute();
      });
    },

    async replaceLifestyle(userId, l, ifVersion) {
      return biodataTx(db, userId, ifVersion, async (tx) => {
        const row = {
          bedtime: l.bedtime,
          wake_time: l.wakeTime,
          cleaning: l.cleaning,
          smoking: l.smoking,
          pets: l.pets,
          food: l.food,
          // PUT replaces: optional answers not sent are cleared.
          cooks_at_home: l.cooksAtHome ?? null,
          drinking: l.drinking ?? null,
          guests: l.guests ?? null,
          parties: l.parties ?? null,
          work_mode: l.workMode ?? null,
        };
        await tx
          .insertInto('lifestyle')
          .values({ user_id: userId, ...row })
          .onConflict((oc) => oc.column('user_id').doUpdateSet(row))
          .execute();
      });
    },

    async replaceImportance(userId, importance, ifVersion) {
      return biodataTx(db, userId, ifVersion, async (tx) => {
        await tx.deleteFrom('lifestyle_importance').where('user_id', '=', userId).execute();
        // Object.entries widens keys to string and values to possibly-undefined; the request
        // schema (partialRecord over LifestyleAttribute) guarantees both.
        const rows = Object.entries(importance).map(([attribute, level]) => ({
          user_id: userId,
          attribute: attribute as keyof ImportanceMap,
          importance: level!,
        }));
        if (rows.length > 0) await tx.insertInto('lifestyle_importance').values(rows).execute();
      });
    },

    async upsertScenarioAnswers(userId, answers, ifVersion) {
      return biodataTx(db, userId, ifVersion, async (tx) => {
        await tx
          .insertInto('scenario_answers')
          .values(
            answers.map((a) => ({
              user_id: userId,
              question_id: a.questionId,
              option_id: a.optionId,
            })),
          )
          .onConflict((oc) =>
            oc.columns(['user_id', 'question_id']).doUpdateSet({
              option_id: (eb) => eb.ref('excluded.option_id'),
              answered_at: sql`now()`,
            }),
          )
          .execute();
      });
    },

    async listPhotos(userId) {
      const rows = await db
        .selectFrom('profile_photos')
        .select(['id', 'storage_path', 'position', 'moderation_status'])
        .where('user_id', '=', userId)
        .orderBy('position')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        storagePath: r.storage_path,
        position: r.position,
        moderationStatus: r.moderation_status,
      }));
    },

    async addPhoto(userId, photo, ifVersion) {
      return db.transaction().execute(async (tx) => {
        if (!(await lockAndTouch(tx, userId, ifVersion))) return null;
        const replaced = await tx
          .deleteFrom('profile_photos')
          .where('user_id', '=', userId)
          .where('position', '=', photo.position)
          .returning('storage_path')
          .executeTakeFirst();
        const inserted = await tx
          .insertInto('profile_photos')
          .values({
            user_id: userId,
            storage_path: photo.storagePath,
            position: photo.position,
            width: photo.width,
            height: photo.height,
            phash: photo.phash,
            // Face and explicit-content checks need a vendor (Blocked): human moderation decides.
            has_face: null,
            moderation_status: 'pending',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await recomputeCompletion(tx, userId);
        return { id: inserted.id, replacedPath: replaced?.storage_path ?? null };
      });
    },

    async reorderPhotos(userId, ids, ifVersion) {
      return withRollbackOn<'ok' | 'stale', 'mismatch'>(db, async (tx) => {
        if (!(await lockAndTouch(tx, userId, ifVersion))) return 'stale' as const;
        const rows = await tx
          .selectFrom('profile_photos')
          .selectAll()
          .where('user_id', '=', userId)
          .execute();
        const byId = new Map(rows.map((r) => [r.id, r]));
        if (ids.length !== rows.length || !ids.every((id) => byId.has(id)))
          throw new Rollback('mismatch' as const);
        await rewritePositions(
          tx,
          userId,
          ids.map((id) => byId.get(id)!),
        );
        return 'ok' as const;
      });
    },

    async deletePhoto(userId, photoId, ifVersion) {
      return withRollbackOn<{ storagePath: string } | 'stale', 'not_found' | 'last'>(
        db,
        async (tx) => {
          if (!(await lockAndTouch(tx, userId, ifVersion))) return 'stale' as const;
          const rows = await tx
            .selectFrom('profile_photos')
            .selectAll()
            .where('user_id', '=', userId)
            .orderBy('position')
            .execute();
          const target = rows.find((r) => r.id === photoId);
          if (!target) throw new Rollback('not_found' as const);
          if (rows.length <= 1) throw new Rollback('last' as const);
          await rewritePositions(
            tx,
            userId,
            rows.filter((r) => r.id !== photoId),
          );
          await recomputeCompletion(tx, userId);
          return { storagePath: target.storage_path };
        },
      );
    },

    async listConsents(userId) {
      const rows = await db
        .selectFrom('consents')
        .select(['purpose', 'version', 'granted_at', 'withdrawn_at'])
        .where('user_id', '=', userId)
        .orderBy('granted_at', 'desc')
        .orderBy('purpose')
        .execute();
      return rows.map(consentRecord);
    },

    async grantConsent(userId, grant) {
      // Append-only: a new row unless the same version is already active.
      const inserted = await db
        .insertInto('consents')
        .values({ user_id: userId, purpose: grant.purpose, version: grant.version })
        .onConflict((oc) =>
          oc
            .columns(['user_id', 'purpose', 'version'])
            .where('withdrawn_at', 'is', null)
            .doNothing(),
        )
        .returning(['purpose', 'version', 'granted_at', 'withdrawn_at'])
        .executeTakeFirst();
      if (inserted) return { record: consentRecord(inserted), created: true };
      const active = await db
        .selectFrom('consents')
        .select(['purpose', 'version', 'granted_at', 'withdrawn_at'])
        .where('user_id', '=', userId)
        .where('purpose', '=', grant.purpose)
        .where('version', '=', grant.version)
        .where('withdrawn_at', 'is', null)
        .executeTakeFirstOrThrow();
      return { record: consentRecord(active), created: false };
    },

    async withdrawConsent(userId, purpose) {
      const res = await db
        .updateTable('consents')
        .set({ withdrawn_at: sql`now()` })
        .where('user_id', '=', userId)
        .where('purpose', '=', purpose)
        .where('withdrawn_at', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) > 0;
    },
  };
}
