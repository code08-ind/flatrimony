/**
 * Daily purge of spent work/college email links (T3.3; docs/04 §12: "Expired email verification
 * tokens · 7 days"). A link that was never confirmed is deleted a week after it expired; its
 * attempt in public.verifications stays (status only). Confirmed links stay: they back the badge
 * and keep one mailbox on one account (migration 0015).
 */
import { sql } from 'kysely';
import type { Task } from '../runner.js';

export const EMAIL_LINK_RETENTION_DAYS = 7;
export const EMAIL_LINK_PURGE_BATCH = 5_000;

export function emailLinkPurge(batch = EMAIL_LINK_PURGE_BATCH): Task {
  return {
    name: 'verifications.purge-email-links',
    async run({ db }) {
      const { rows } = await sql<{ id: string }>`
        delete from private.email_verifications
         where id in (
           select id from private.email_verifications
            where consumed_at is null
              and expires_at < now() - make_interval(days => ${EMAIL_LINK_RETENTION_DAYS})
            order by expires_at
            limit ${batch})
        returning id`.execute(db);
      return { purged: rows.length };
    },
  };
}
