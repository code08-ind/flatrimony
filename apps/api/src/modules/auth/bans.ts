/** Banned identities (private.banned_identities; FR-AUTH-08). Read-only here; bans are written by admin (T6.2). */
import { sql } from 'kysely';
import type { Database } from '../../lib/db.js';

export interface BansRepository {
  /** True if any of the given hashes is banned. */
  isBanned(hashes: {
    phoneHash?: Buffer;
    deviceHash?: Buffer;
    digilockerIdHash?: Buffer;
  }): Promise<boolean>;
}

export function pgBansRepository(db: Database): BansRepository {
  return {
    async isBanned({ phoneHash, deviceHash, digilockerIdHash }) {
      const conditions = [
        phoneHash ? sql`phone_hash = ${phoneHash}` : undefined,
        deviceHash ? sql`device_hash = ${deviceHash}` : undefined,
        digilockerIdHash ? sql`digilocker_id_hash = ${digilockerIdHash}` : undefined,
      ].filter((c) => c !== undefined);
      if (conditions.length === 0) return false;
      const row = await db
        .selectFrom('private.banned_identities')
        .select(sql<number>`1`.as('one'))
        .where(sql<boolean>`${sql.join(conditions, sql` or `)}`)
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}

/** For tests and local runs without a database. */
export function memoryBansRepository(
  banned: { phone?: Buffer[]; device?: Buffer[] } = {},
): BansRepository {
  const has = (list: Buffer[] | undefined, h: Buffer | undefined) =>
    !!h && !!list?.some((b) => b.equals(h));
  return {
    async isBanned({ phoneHash, deviceHash }) {
      return has(banned.phone, phoneHash) || has(banned.device, deviceHash);
    },
  };
}
