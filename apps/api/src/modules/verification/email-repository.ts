/**
 * Work and college email verification in Postgres (T3.3; docs/04 §6.3, §15.10; docs/05 §8.4).
 *
 * An attempt is a row in public.verifications (type work_email / college_email; its owner sees its
 * status) and its link a row in private.email_verifications: the domain, an HMAC of the address
 * (never the address) and the SHA-256 of the link's token. Confirming is one transaction: the link
 * is spent, the attempt verified and the profile's badge set; migration 0015's triggers check at
 * commit that the badge has a confirmed link and that one mailbox badges one account.
 */
import { sql } from 'kysely';
import type { EmailVerificationType } from '@flatrimony/shared';
import type { Database } from '../../lib/db.js';
import { lockAndTouch } from '../me/repository.js';

export interface EmailStartWrite {
  id: string;
  type: EmailVerificationType;
  domain: string;
  addressHash: Buffer;
  tokenHash: Buffer;
  expiresAt: Date;
  /** Links to one address per day, all members together. */
  maxPerAddressPerDay: number;
  /** Links one member may send to one address per day. */
  maxPerMemberAddressPerDay: number;
}

export type EmailStartOutcome =
  | { status: 'started' }
  /** This address had its links for today. */
  | { status: 'address_limited' }
  /** Another request of this member for this type won the race. */
  | { status: 'in_progress' }
  /** The badge arrived meanwhile (a link opened while this request ran). */
  | { status: 'already_verified' };

export type EmailConfirmOutcome =
  | { status: 'verified'; type: EmailVerificationType; userId: string }
  /** Unknown, replaced by a newer link, already used, or its account is deleted. */
  | { status: 'invalid' }
  | { status: 'expired' }
  /** The address is already confirmed on an account (this one for the other type, or another). */
  | { status: 'email_in_use'; type: EmailVerificationType };

export interface EmailBadgeState {
  hasWorkBadge: boolean;
  hasCollegeBadge: boolean;
  locale: string;
}

export interface EmailVerificationRepository {
  badges(userId: string): Promise<EmailBadgeState | null>;
  /** Replaces any pending attempt of this type and opens a new one with its link. */
  start(userId: string, write: EmailStartWrite): Promise<EmailStartOutcome>;
  /** The email could not be sent: the attempt fails (provider_error) and its link is spent. */
  sendFailed(verificationId: string): Promise<void>;
  confirm(tokenHash: Buffer): Promise<EmailConfirmOutcome>;
}

const uniqueViolation = (err: unknown, constraint: string) => {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && e.constraint === constraint;
};

const BADGE_COLUMN = {
  work_email: 'has_work_badge',
  college_email: 'has_college_badge',
} as const;

export function pgEmailVerificationRepository(db: Database): EmailVerificationRepository {
  const fail = (tx: Database, id: string, code: 'provider_error' | 'email_in_use') =>
    tx
      .updateTable('verifications')
      .set({ status: 'failed', failure_code: code, completed_at: sql`now()` })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .execute();

  return {
    async badges(userId) {
      const row = await db
        .selectFrom('profiles')
        .select(['has_work_badge', 'has_college_badge', 'locale'])
        .where('id', '=', userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return row
        ? {
            hasWorkBadge: row.has_work_badge,
            hasCollegeBadge: row.has_college_badge,
            locale: row.locale,
          }
        : null;
    },

    async start(userId, write) {
      try {
        return await db.transaction().execute(async (tx) => {
          // Count and insert under one lock per address, so two requests cannot both take the
          // last link of the day.
          await sql`select pg_advisory_xact_lock(hashtextextended(${write.addressHash.toString('hex')}, 0))`.execute(
            tx,
          );
          // Two caps: one member cannot flood an inbox, and several members together cannot
          // either; a member who asks for someone else's address only uses up their own share.
          const recent = await tx
            .selectFrom('private.email_verifications')
            .select((eb) => [
              eb.fn.countAll<string>().as('all'),
              sql<string>`count(*) filter (where user_id = ${userId})`.as('mine'),
            ])
            .where('address_hash', '=', write.addressHash)
            .where('created_at', '>', sql<Date>`now() - interval '1 day'`)
            .executeTakeFirstOrThrow();
          if (
            Number(recent.mine) >= write.maxPerMemberAddressPerDay ||
            Number(recent.all) >= write.maxPerAddressPerDay
          )
            return { status: 'address_limited' } as const;

          // The badge may have arrived since the route looked (a link opened meanwhile); the
          // profile row lock orders this against confirm, which locks it too.
          const profile = await tx
            .selectFrom('profiles')
            .select(['has_work_badge', 'has_college_badge'])
            .where('id', '=', userId)
            .forUpdate()
            .executeTakeFirst();
          if (profile?.[BADGE_COLUMN[write.type]]) return { status: 'already_verified' } as const;

          // One pending attempt per member and type: a new request replaces the older link.
          await tx
            .updateTable('verifications')
            .set({ status: 'expired', completed_at: sql`now()` })
            .where('user_id', '=', userId)
            .where('type', '=', write.type)
            .where('status', '=', 'pending')
            .execute();
          await tx
            .insertInto('verifications')
            .values({
              id: write.id,
              user_id: userId,
              type: write.type,
              provider: 'internal_email',
              expires_at: write.expiresAt,
            })
            .execute();
          await tx
            .insertInto('private.email_verifications')
            .values({
              verification_id: write.id,
              user_id: userId,
              type: write.type,
              email_domain: write.domain,
              address_hash: write.addressHash,
              token_hash: write.tokenHash,
              expires_at: write.expiresAt,
            })
            .execute();
          return { status: 'started' } as const;
        });
      } catch (err) {
        if (uniqueViolation(err, 'verifications_one_pending_idx')) return { status: 'in_progress' };
        throw err;
      }
    },

    async sendFailed(verificationId) {
      // A link that arrives late (a slow vendor) does not work: confirm needs a pending attempt.
      await fail(db, verificationId, 'provider_error');
    },

    async confirm(tokenHash) {
      try {
        return await db.transaction().execute(async (tx): Promise<EmailConfirmOutcome> => {
          const link = await tx
            .selectFrom('private.email_verifications as e')
            .innerJoin('verifications as v', 'v.id', 'e.verification_id')
            .innerJoin('profiles as p', 'p.id', 'e.user_id')
            .select([
              'e.id',
              'e.user_id',
              'e.type',
              'e.address_hash',
              'e.consumed_at',
              sql<boolean>`e.expires_at <= now()`.as('expired'),
              'v.id as verification_id',
              'v.status',
              'p.deleted_at',
            ])
            .where('e.token_hash', '=', tokenHash)
            .forUpdate()
            .executeTakeFirst();
          if (!link || link.deleted_at) return { status: 'invalid' };
          const type = link.type as EmailVerificationType;
          // Opened twice (a mail scanner first, then the member): the same answer.
          if (link.consumed_at)
            return link.status === 'verified'
              ? { status: 'verified', type, userId: link.user_id }
              : { status: 'invalid' };
          // Past its time: expired, however often it is opened (a replaced link is invalid).
          if (link.expired && (link.status === 'pending' || link.status === 'expired')) {
            if (link.status === 'pending')
              await tx
                .updateTable('verifications')
                .set({ status: 'expired', completed_at: sql`now()` })
                .where('id', '=', link.verification_id)
                .execute();
            return { status: 'expired' };
          }
          if (link.status !== 'pending') return { status: 'invalid' };
          const taken = await tx
            .selectFrom('private.email_verifications')
            .select('id')
            .where('address_hash', '=', link.address_hash)
            .where('consumed_at', 'is not', null)
            .executeTakeFirst();
          if (taken) {
            await fail(tx, link.verification_id, 'email_in_use');
            return { status: 'email_in_use', type };
          }

          await tx
            .updateTable('private.email_verifications')
            .set({ consumed_at: sql`now()` })
            .where('id', '=', link.id)
            .execute();
          await tx
            .updateTable('verifications')
            .set({ status: 'verified', completed_at: sql`now()` })
            .where('id', '=', link.verification_id)
            .execute();
          // The profile's version changes (ETag), like every other write to it.
          await lockAndTouch(tx, link.user_id);
          await tx
            .updateTable('profiles')
            .set({ [BADGE_COLUMN[type]]: true })
            .where('id', '=', link.user_id)
            .execute();
          return { status: 'verified', type, userId: link.user_id };
        });
      } catch (err) {
        // Two members confirmed the same mailbox at the same moment: the second one loses.
        if (uniqueViolation(err, 'email_verifications_address_confirmed_key')) {
          const row = await db
            .selectFrom('private.email_verifications')
            .select(['verification_id', 'type'])
            .where('token_hash', '=', tokenHash)
            .executeTakeFirst();
          if (!row) return { status: 'invalid' };
          await fail(db, row.verification_id, 'email_in_use');
          return { status: 'email_in_use', type: row.type as EmailVerificationType };
        }
        throw err;
      }
    },
  };
}
