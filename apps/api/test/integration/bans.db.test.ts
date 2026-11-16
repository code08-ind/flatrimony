/** Banned-identity lookup against Postgres (T2.3). Skipped without DATABASE_URL. */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/lib/db.js';
import { pgBansRepository } from '../../src/modules/auth/bans.js';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('pgBansRepository', () => {
  let db: Database;
  const phoneHash = randomBytes(32);
  const deviceHash = randomBytes(32);
  const dlHash = randomBytes(32);

  beforeAll(async () => {
    db = createDatabase(url!, { max: 2 });
    await sql`insert into private.banned_identities (phone_hash, reason) values (${phoneHash}, 'integration test')`.execute(
      db,
    );
    await sql`insert into private.banned_identities (device_hash, digilocker_id_hash, reason) values (${deviceHash}, ${dlHash}, 'integration test')`.execute(
      db,
    );
  });
  afterAll(async () => {
    await sql`delete from private.banned_identities where reason = 'integration test'`.execute(db);
    await db.destroy();
  });

  it('finds bans by phone, device or DigiLocker hash, alone or combined', async () => {
    const bans = pgBansRepository(db);
    expect(await bans.isBanned({ phoneHash })).toBe(true);
    expect(await bans.isBanned({ deviceHash })).toBe(true);
    expect(await bans.isBanned({ digilockerIdHash: dlHash })).toBe(true);
    expect(await bans.isBanned({ phoneHash: randomBytes(32), deviceHash })).toBe(true);
    expect(await bans.isBanned({ phoneHash: randomBytes(32), deviceHash: randomBytes(32) })).toBe(
      false,
    );
    expect(await bans.isBanned({})).toBe(false);
  });
});
