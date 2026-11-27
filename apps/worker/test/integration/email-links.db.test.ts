/**
 * Purge of spent work/college email links (T3.3; docs/04 §12). Skipped without DATABASE_URL.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/db.js';
import { createLogger } from '../../src/log.js';
import { emailLinkPurge } from '../../src/tasks/email-links.js';

const URL = process.env.DATABASE_URL;

describe.skipIf(!URL)('email link purge (Postgres)', () => {
  let db: Database;
  const member = randomUUID();
  const ctx = () => ({
    db,
    log: createLogger('error', () => {}),
    signal: new AbortController().signal,
  });

  /** A link that expired `daysAgo` days ago (created a day before that). */
  async function link(daysAgo: number, confirmed = false): Promise<string> {
    const id = randomUUID();
    await sql`insert into public.verifications (id, user_id, type, provider, status, started_at, completed_at, expires_at)
      values (${id}, ${member}, 'work_email', 'internal_email',
        ${confirmed ? 'verified' : 'expired'}::public.verification_status,
        now() - (${daysAgo + 1} * interval '1 day'), now() - (${daysAgo + 1} * interval '1 day') + interval '1 minute',
        now() - (${daysAgo} * interval '1 day'))`.execute(db);
    await sql`insert into private.email_verifications
        (verification_id, user_id, type, email_domain, token_hash, address_hash, created_at, expires_at, consumed_at)
      values (${id}, ${member}, 'work_email', 'example.com',
        ${createHash('sha256').update(randomBytes(32)).digest()}, ${randomBytes(32)},
        now() - (${daysAgo + 1} * interval '1 day'), now() - (${daysAgo} * interval '1 day'),
        ${confirmed ? sql`now() - (${daysAgo + 1} * interval '1 day') + interval '1 minute'` : null})`.execute(
      db,
    );
    return id;
  }
  const exists = async (verificationId: string) =>
    !!(await db
      .selectFrom('private.email_verifications')
      .select('id')
      .where('verification_id', '=', verificationId)
      .executeTakeFirst());

  beforeAll(async () => {
    db = createDatabase(URL!);
    const phone = `9198${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    await sql`insert into auth.users (id, aud, role, phone) values (${member}, 'authenticated', 'authenticated', ${phone})`.execute(
      db,
    );
    await sql`insert into public.profiles (id, display_name, intent) values (${member}, 'Purge Test', 'need_room')`.execute(
      db,
    );
  });
  afterAll(async () => {
    await sql`delete from public.profiles where id = ${member}`.execute(db);
    await sql`delete from auth.users where id = ${member}`.execute(db);
    await db.destroy();
  });

  it('deletes unconfirmed links a week after they expired; keeps recent and confirmed ones', async () => {
    const old = await link(8);
    const recent = await link(3);
    const confirmed = await link(30, true);
    const result = await emailLinkPurge().run(ctx());
    expect(result).toMatchObject({ purged: expect.any(Number) });
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(confirmed)).toBe(true);
    // The attempt itself stays (status only).
    const v = await db
      .selectFrom('verifications')
      .select('status')
      .where('id', '=', old)
      .executeTakeFirst();
    expect(v?.status).toBe('expired');
  });
});
