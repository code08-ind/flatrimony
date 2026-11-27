/**
 * Work and college email verification on Postgres (T3.3; docs/04 §15.10, docs/05 §8.4): links,
 * replacement, expiry, the per-address limit, one mailbox per account, badges. Skipped without
 * DATABASE_URL.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailVerificationType } from '@flatrimony/shared';
import { createDatabase, type Database } from '../../src/lib/db.js';
import {
  pgEmailVerificationRepository,
  type EmailVerificationRepository,
} from '../../src/modules/verification/email-repository.js';

const url = process.env.DATABASE_URL;
const sha = (s: string) => createHash('sha256').update(s).digest();

describe.skipIf(!url)('pgEmailVerificationRepository', () => {
  let db: Database;
  let repo: EmailVerificationRepository;
  const users: string[] = [];

  async function user(): Promise<string> {
    const id = randomUUID();
    users.push(id);
    const phone = `9197${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    await sql`insert into auth.users (id, aud, role, phone) values (${id}, 'authenticated', 'authenticated', ${phone})`.execute(
      db,
    );
    await sql`insert into public.profiles (id, display_name, intent) values (${id}, 'Asha', 'need_room')`.execute(
      db,
    );
    return id;
  }

  async function link(
    userId: string,
    over: {
      type?: EmailVerificationType;
      address?: Buffer;
      ttlMs?: number;
      max?: number;
      maxMine?: number;
    } = {},
  ) {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const outcome = await repo.start(userId, {
      id,
      type: over.type ?? 'work_email',
      domain: over.type === 'college_email' ? 'iitd.ac.in' : 'infosys.com',
      addressHash: over.address ?? randomBytes(32),
      tokenHash: sha(token),
      expiresAt: new Date(Date.now() + (over.ttlMs ?? 24 * 60 * 60_000)),
      maxPerAddressPerDay: over.max ?? 3,
      maxPerMemberAddressPerDay: over.maxMine ?? 3,
    });
    return { id, token, outcome };
  }

  const status = async (id: string) =>
    await db
      .selectFrom('verifications')
      .select(['status', 'failure_code'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  beforeAll(() => {
    db = createDatabase(url!);
    repo = pgEmailVerificationRepository(db);
  });
  afterAll(async () => {
    if (users.length) await db.deleteFrom('profiles').where('id', 'in', users).execute();
    if (users.length)
      await sql`delete from auth.users where id in (${sql.join(users)})`.execute(db);
    await db.destroy();
  });

  it('confirms a link: attempt verified, badge set, profile version changed; twice is the same', async () => {
    const u = await user();
    const before = await db
      .selectFrom('profiles')
      .select('updated_at')
      .where('id', '=', u)
      .executeTakeFirstOrThrow();
    const { id, token, outcome } = await link(u);
    expect(outcome).toEqual({ status: 'started' });
    expect(await status(id)).toEqual({ status: 'pending', failure_code: null });

    expect(await repo.confirm(sha(token))).toEqual({
      status: 'verified',
      type: 'work_email',
      userId: u,
    });
    expect(await status(id)).toEqual({ status: 'verified', failure_code: null });
    const p = await db
      .selectFrom('profiles')
      .select(['has_work_badge', 'has_college_badge', 'updated_at'])
      .where('id', '=', u)
      .executeTakeFirstOrThrow();
    expect(p.has_work_badge).toBe(true);
    expect(p.has_college_badge).toBe(false);
    expect(new Date(p.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    expect(await repo.badges(u)).toEqual({
      hasWorkBadge: true,
      hasCollegeBadge: false,
      locale: 'en',
    });

    // A mail scanner opened it first: the member's own click still says verified.
    expect((await repo.confirm(sha(token))).status).toBe('verified');
  });

  it('stores the domain and hashes, never the address', async () => {
    const u = await user();
    const { id } = await link(u, { type: 'college_email' });
    const row = await db
      .selectFrom('private.email_verifications')
      .select(['email_domain', 'address_hash', 'token_hash'])
      .where('verification_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.email_domain).toBe('iitd.ac.in');
    expect(row.address_hash).toHaveLength(32);
    expect(row.token_hash).toHaveLength(32);
  });

  it('a newer link replaces the older one', async () => {
    const u = await user();
    const first = await link(u);
    const second = await link(u);
    expect((await status(first.id)).status).toBe('expired');
    expect(await repo.confirm(sha(first.token))).toEqual({ status: 'invalid' });
    expect((await repo.confirm(sha(second.token))).status).toBe('verified');
  });

  it('work and college links live side by side', async () => {
    const u = await user();
    const work = await link(u, { type: 'work_email' });
    const college = await link(u, { type: 'college_email' });
    expect((await repo.confirm(sha(work.token))).status).toBe('verified');
    expect((await repo.confirm(sha(college.token))).status).toBe('verified');
    expect(await repo.badges(u)).toMatchObject({ hasWorkBadge: true, hasCollegeBadge: true });
  });

  it('an expired link expires its attempt', async () => {
    const u = await user();
    const { id, token } = await link(u);
    await db
      .updateTable('private.email_verifications')
      .set({ expires_at: sql`created_at + interval '1 millisecond'` })
      .where('verification_id', '=', id)
      .execute();
    expect(await repo.confirm(sha(token))).toEqual({ status: 'expired' });
    expect((await status(id)).status).toBe('expired');
    // Opened again: still "expired", not "used or replaced".
    expect(await repo.confirm(sha(token))).toEqual({ status: 'expired' });
    expect((await repo.badges(u))!.hasWorkBadge).toBe(false);
  });

  it('no new link once the badge is there (a link opened meanwhile)', async () => {
    const u = await user();
    const first = await link(u);
    expect((await repo.confirm(sha(first.token))).status).toBe('verified');
    expect((await link(u)).outcome).toEqual({ status: 'already_verified' });
    expect((await link(u, { type: 'college_email' })).outcome).toEqual({ status: 'started' });
  });

  it('unknown tokens and deleted accounts are invalid', async () => {
    expect(await repo.confirm(sha('nope'))).toEqual({ status: 'invalid' });
    const u = await user();
    const { token } = await link(u);
    await db
      .updateTable('profiles')
      .set({ deleted_at: sql`now()` })
      .where('id', '=', u)
      .execute();
    expect(await repo.confirm(sha(token))).toEqual({ status: 'invalid' });
    expect(await repo.badges(u)).toBeNull();
  });

  it('one mailbox, one account', async () => {
    const address = randomBytes(32);
    const a = await user();
    const b = await user();
    const la = await link(a, { address });
    const lb = await link(b, { address });
    expect((await repo.confirm(sha(la.token))).status).toBe('verified');
    expect(await repo.confirm(sha(lb.token))).toEqual({
      status: 'email_in_use',
      type: 'work_email',
    });
    expect(await status(lb.id)).toEqual({ status: 'failed', failure_code: 'email_in_use' });
    expect((await repo.badges(b))!.hasWorkBadge).toBe(false);
  });

  it('two members confirming one mailbox at once: exactly one wins', async () => {
    const address = randomBytes(32);
    const a = await user();
    const b = await user();
    const la = await link(a, { address });
    const lb = await link(b, { address });
    const results = await Promise.all([repo.confirm(sha(la.token)), repo.confirm(sha(lb.token))]);
    expect(results.map((r) => r.status).sort()).toEqual(['email_in_use', 'verified']);
  });

  it('caps the links to one address per day, whoever asks', async () => {
    const address = randomBytes(32);
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) outcomes.push((await link(await user(), { address })).outcome);
    expect(outcomes.map((o) => o.status)).toEqual([
      'started',
      'started',
      'started',
      'address_limited',
    ]);
  });

  it('one member uses only their own share of an address', async () => {
    const address = randomBytes(32);
    const asker = await user();
    const outcomes = [];
    for (let i = 0; i < 3; i += 1)
      outcomes.push((await link(asker, { address, max: 10, maxMine: 2 })).outcome.status);
    expect(outcomes).toEqual(['started', 'started', 'address_limited']);
    // The mailbox's owner still gets a link.
    expect((await link(await user(), { address, max: 10, maxMine: 2 })).outcome.status).toBe(
      'started',
    );
  });

  it('concurrent requests for one address never pass the cap', async () => {
    const address = randomBytes(32);
    const members = await Promise.all([user(), user(), user(), user(), user()]);
    const outcomes = await Promise.all(members.map((m) => link(m, { address, max: 2 })));
    expect(outcomes.filter((o) => o.outcome.status === 'started')).toHaveLength(2);
  });

  it('a failed send fails the attempt and its link stops working', async () => {
    const u = await user();
    const { id, token } = await link(u);
    await repo.sendFailed(id);
    expect(await status(id)).toEqual({ status: 'failed', failure_code: 'provider_error' });
    expect(await repo.confirm(sha(token))).toEqual({ status: 'invalid' });
  });
});
