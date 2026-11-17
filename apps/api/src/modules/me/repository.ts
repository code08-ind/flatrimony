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
  type Intent,
  type Me,
  type Platform,
} from '@flatrimony/shared';
import type { VerifiedGender } from '@flatrimony/db-types';
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

      const [prefs, areas, anchor, life, importance] = await Promise.all([
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
