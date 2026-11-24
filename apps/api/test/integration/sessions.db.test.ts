/** Session revocation lookup against Supabase's auth.sessions (docs/05 §2). Skipped without DATABASE_URL. */
import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/lib/db.js';
import { pgSessionLookup } from '../../src/modules/auth/sessions.js';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('pgSessionLookup', () => {
  let db: Database;
  const user = randomUUID();
  const other = randomUUID();
  const live = randomUUID();
  const ended = randomUUID();
  const phone = () => `9196${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  beforeAll(async () => {
    db = createDatabase(url!, { max: 2 });
    for (const id of [user, other])
      await sql`insert into auth.users (id, aud, role, phone) values (${id}, 'authenticated', 'authenticated', ${phone()})`.execute(
        db,
      );
    await sql`insert into auth.sessions (id, user_id, created_at, updated_at) values (${live}, ${user}, now(), now())`.execute(
      db,
    );
    await sql`insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values (${ended}, ${user}, now(), now(), now() - interval '1 minute')`.execute(
      db,
    );
  });
  afterAll(async () => {
    await sql`delete from auth.users where id in (${user}, ${other})`.execute(db); // sessions cascade
    await db.destroy();
  });

  it('a live session of this user is active', async () => {
    expect(await pgSessionLookup(db)(live, user)).toBe(true);
  });

  it('a signed-out (deleted), timed-out or someone else’s session is not', async () => {
    const lookup = pgSessionLookup(db);
    expect(await lookup(randomUUID(), user)).toBe(false);
    expect(await lookup(ended, user)).toBe(false);
    expect(await lookup(live, other)).toBe(false);
    expect(await lookup('not-a-uuid', user)).toBe(false);
    await sql`delete from auth.sessions where id = ${live}`.execute(db);
    expect(await lookup(live, user)).toBe(false);
  });
});
