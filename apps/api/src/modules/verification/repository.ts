/**
 * DigiLocker verifications in Postgres (docs/04 §6.3, docs/05 §8.4): public.verifications for the
 * attempt (its owner can see status and failure code), private.identity_records for the result
 * (never exposed: encrypted name, DOB, gender, the DigiLocker id's HMAC).
 *
 * Completing a verification is one transaction: the attempt and the profile are locked, the checks
 * of outcome.ts run, and either the identity record is written and the profile marked verified
 * (DOB and gender from DigiLocker; a women-only profile with a non-female result moves to
 * "professional"), or the attempt is marked failed. The deferred triggers of migration 0005 check
 * at commit that a verified profile matches its identity record.
 */
import { sql } from 'kysely';
import type { Verification, VerificationFailureCode } from '@flatrimony/shared';
import type { Database } from '../../lib/db.js';
import type { FieldCipher } from '../../lib/field-crypto.js';
import type { IdentifierHasher } from '../../lib/hashing.js';
import { lockAndTouch, recomputeCompletion } from '../me/repository.js';
import { decideOutcome } from './outcome.js';
import type { DigiLockerIdentity } from './provider.js';

export interface StartWrite {
  id: string;
  provider: string;
  providerRef: string;
  expiresAt: Date;
  /** The identity_verification consent given with this start. */
  consentVersion: string;
}

export type CompleteOutcome =
  | { status: 'verified'; categoryChanged: boolean }
  | { status: 'failed'; failureCode: VerificationFailureCode }
  /** Already decided (a repeated webhook), or unknown. */
  | { status: 'not_pending' };

export interface VerificationRepository {
  /** Records the consent, expires any pending DigiLocker attempt and opens a new one. */
  start(userId: string, write: StartWrite): Promise<void>;
  /** The caller's attempt (pending ones past their expiry become expired first), or null. */
  get(userId: string, id: string): Promise<Verification | null>;
  list(userId: string): Promise<Verification[]>;
  /** The pending attempt a provider reference belongs to. */
  findPending(
    provider: string,
    providerRef: string,
  ): Promise<{ id: string; userId: string } | null>;
  fail(id: string, code: VerificationFailureCode): Promise<boolean>;
  complete(
    id: string,
    identity: DigiLockerIdentity,
    ctx: { today: string },
  ): Promise<CompleteOutcome>;
}

type Row = {
  id: string;
  type: Verification['type'];
  status: Verification['status'];
  failure_code: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  expires_at: Date | string | null;
};
const iso = (v: Date | string) => new Date(v).toISOString();
const toVerification = (r: Row): Verification => ({
  id: r.id,
  type: r.type,
  status: r.status,
  failureCode: (r.failure_code as VerificationFailureCode | null) ?? null,
  startedAt: iso(r.started_at),
  completedAt: r.completed_at ? iso(r.completed_at) : null,
  expiresAt: r.expires_at ? iso(r.expires_at) : null,
});
const COLUMNS = [
  'id',
  'type',
  'status',
  'failure_code',
  'started_at',
  'completed_at',
  'expires_at',
] as const;

/** Postgres unique violation of the one-identity-per-account rule. */
const identityTaken = (err: unknown) => {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && e.constraint === 'identity_records_digilocker_id_hash_key';
};

export function pgVerificationRepository(
  db: Database,
  deps: { hasher: IdentifierHasher; cipher: FieldCipher },
): VerificationRepository {
  /** Pending attempts of this user that have run out become expired. */
  const expireStale = (tx: Database, userId: string) =>
    tx
      .updateTable('verifications')
      .set({ status: 'expired', completed_at: sql`now()` })
      .where('user_id', '=', userId)
      .where('status', '=', 'pending')
      .where('expires_at', '<', sql<Date>`now()`)
      .execute();

  async function markFailed(id: string, code: VerificationFailureCode): Promise<boolean> {
    const res = await db
      .updateTable('verifications')
      .set({ status: 'failed', failure_code: code, completed_at: sql`now()` })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  return {
    async start(userId, write) {
      await db.transaction().execute(async (tx) => {
        await tx
          .insertInto('consents')
          .values({
            user_id: userId,
            purpose: 'identity_verification',
            version: write.consentVersion,
          })
          .onConflict((oc) =>
            oc
              .columns(['user_id', 'purpose', 'version'])
              .where('withdrawn_at', 'is', null)
              .doNothing(),
          )
          .execute();
        // One pending attempt per user and type (verifications_one_pending_idx): a new start
        // replaces an unfinished one.
        await tx
          .updateTable('verifications')
          .set({ status: 'expired', completed_at: sql`now()` })
          .where('user_id', '=', userId)
          .where('type', '=', 'digilocker')
          .where('status', '=', 'pending')
          .execute();
        await tx
          .insertInto('verifications')
          .values({
            id: write.id,
            user_id: userId,
            type: 'digilocker',
            provider: write.provider,
            provider_ref: write.providerRef,
            expires_at: write.expiresAt,
          })
          .execute();
      });
    },

    async get(userId, id) {
      await expireStale(db, userId);
      const row = await db
        .selectFrom('verifications')
        .select(COLUMNS)
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      return row ? toVerification(row) : null;
    },

    async list(userId) {
      await expireStale(db, userId);
      const rows = await db
        .selectFrom('verifications')
        .select(COLUMNS)
        .where('user_id', '=', userId)
        .orderBy('started_at', 'desc')
        .limit(50)
        .execute();
      return rows.map(toVerification);
    },

    async findPending(provider, providerRef) {
      const row = await db
        .selectFrom('verifications')
        .select(['id', 'user_id'])
        .where('provider', '=', provider)
        .where('provider_ref', '=', providerRef)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      return row ? { id: row.id, userId: row.user_id } : null;
    },

    fail: markFailed,

    async complete(id, identity, { today }) {
      const hash = deps.hasher('digilocker', identity.digilockerId.trim());
      try {
        return await db.transaction().execute(async (tx): Promise<CompleteOutcome> => {
          const attempt = await tx
            .selectFrom('verifications')
            .select(['user_id', 'status'])
            .where('id', '=', id)
            .forUpdate()
            .executeTakeFirst();
          if (!attempt || attempt.status !== 'pending') return { status: 'not_pending' };
          const userId = attempt.user_id;
          if (!(await lockAndTouch(tx, userId))) return { status: 'not_pending' };
          const profile = await tx
            .selectFrom('profiles')
            .select(['display_name', 'category', 'is_identity_verified'])
            .where('id', '=', userId)
            .executeTakeFirstOrThrow();
          const banned = await tx
            .selectFrom('private.banned_identities')
            .select(sql<number>`1`.as('one'))
            .where('digilocker_id_hash', '=', hash)
            .executeTakeFirst();
          const holder = await tx
            .selectFrom('private.identity_records')
            .select('user_id')
            .where('digilocker_id_hash', '=', hash)
            .executeTakeFirst();
          if (profile.is_identity_verified) {
            // Verified meanwhile (starting is refused once verified): this attempt is moot.
            await tx
              .updateTable('verifications')
              .set({ status: 'expired', completed_at: sql`now()` })
              .where('id', '=', id)
              .execute();
            return { status: 'not_pending' };
          }
          const failure = decideOutcome({
            displayName: profile.display_name,
            verifiedName: identity.name,
            dateOfBirth: identity.dateOfBirth,
            today,
            banned: !!banned,
            inUseElsewhere: !!holder && holder.user_id !== userId,
          });
          if (failure) {
            await tx
              .updateTable('verifications')
              .set({ status: 'failed', failure_code: failure, completed_at: sql`now()` })
              .where('id', '=', id)
              .execute();
            return { status: 'failed', failureCode: failure };
          }

          await tx
            .insertInto('private.identity_records')
            .values({
              user_id: userId,
              verified_name_enc: deps.cipher.encrypt(identity.name.trim()),
              verified_dob: identity.dateOfBirth,
              verified_gender: identity.gender,
              digilocker_id_hash: hash,
            })
            .execute();
          // FR-VER-06: women-only needs a female DigiLocker result; otherwise the profile moves to
          // "professional" and looks for any flatmate (docs/05 §8.2).
          const categoryChanged = profile.category === 'women_only' && identity.gender !== 'female';
          await tx
            .updateTable('profiles')
            .set({
              is_identity_verified: true,
              verified_gender: identity.gender,
              date_of_birth: identity.dateOfBirth,
              ...(categoryChanged ? { category: 'professional' as const } : {}),
            })
            .where('id', '=', userId)
            .execute();
          if (categoryChanged)
            await tx
              .updateTable('preferences')
              .set({ flatmate_gender_pref: 'any' })
              .where('user_id', '=', userId)
              .where('flatmate_gender_pref', '=', 'female_only')
              .execute();
          await tx
            .updateTable('verifications')
            .set({ status: 'verified', completed_at: sql`now()` })
            .where('id', '=', id)
            .execute();
          await recomputeCompletion(tx, userId);
          return { status: 'verified', categoryChanged };
        });
      } catch (err) {
        // Two accounts finishing with the same DigiLocker identity at once: the second loses.
        if (identityTaken(err))
          return (await markFailed(id, 'identity_in_use'))
            ? { status: 'failed', failureCode: 'identity_in_use' }
            : { status: 'not_pending' };
        throw err;
      }
    },
  };
}
