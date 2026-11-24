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
  const reused = randomUUID();
  /** A refresh token row the way Supabase Auth writes it (classic refresh tokens). */
  const refreshToken = (session: string, revoked: boolean) =>
    sql`insert into auth.refresh_tokens (token, user_id, revoked, session_id, created_at, updated_at)
        values (${randomUUID()}, ${user}, ${revoked}, ${session}, now(), now())`.execute(db);
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
    await sql`insert into auth.sessions (id, user_id, created_at, updated_at) values (${reused}, ${user}, now(), now())`.execute(
      db,
    );
    // Live: an earlier token was rotated (revoked), the current one is not.
    await refreshToken(live, true);
    await refreshToken(live, false);
    await refreshToken(ended, false);
    // Refresh-token reuse: Supabase Auth revokes the whole family and keeps the session row.
    await refreshToken(reused, true);
    await refreshToken(reused, true);
  });
  afterAll(async () => {
    await sql`delete from auth.users where id in (${user}, ${other})`.execute(db); // sessions cascade
    await db.destroy();
  });

  it('a live session of this user is active', async () => {
    expect(await pgSessionLookup(db)(live, user)).toBe(true);
  });

  it('a session whose refresh tokens were all revoked (reuse detected) is not', async () => {
    expect(await pgSessionLookup(db)(reused, user)).toBe(false);
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
