/**
 * DigiLocker verification on Postgres (T3.1; docs/04 §6.3, docs/05 §8.4): starting, completing
 * and failing attempts, the identity record, women-only, uniqueness, bans, expiry. Skipped
 * without DATABASE_URL.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/lib/db.js';
import { createFieldCipher } from '../../src/lib/field-crypto.js';
import { createIdentifierHasher } from '../../src/lib/hashing.js';
import { pgVerificationRepository } from '../../src/modules/verification/repository.js';
import type { DigiLockerIdentity } from '../../src/modules/verification/provider.js';

const url = process.env.DATABASE_URL;
const TODAY = '2026-11-25';

describe.skipIf(!url)('pgVerificationRepository', () => {
  let db: Database;
  const hasher = createIdentifierHasher(randomBytes(32).toString('base64'));
  const cipher = createFieldCipher(randomBytes(32));
  const users: string[] = [];
  let repo: ReturnType<typeof pgVerificationRepository>;

  /** A profile as onboarding leaves it (self-declared DOB, no verification). */
  async function user(
    over: { name?: string; category?: string; femaleOnly?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    users.push(id);
    const phone = `9196${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    await sql`insert into auth.users (id, aud, role, phone) values (${id}, 'authenticated', 'authenticated', ${phone})`.execute(
      db,
    );
    await sql`insert into public.profiles (id, display_name, intent, category, date_of_birth)
      values (${id}, ${over.name ?? 'Asha'}, 'need_room', ${over.category ?? 'professional'}::public.user_category, '1999-01-01')`.execute(
      db,
    );
    if (over.femaleOnly)
      await sql`insert into public.preferences (user_id, budget_min_inr, budget_max_inr, move_in_from, move_in_to, flatmate_gender_pref)
        values (${id}, 10000, 20000, '2026-12-01', '2026-12-31', 'female_only')`.execute(db);
    return id;
  }

  async function started(userId: string): Promise<string> {
    const id = randomUUID();
    await repo.start(userId, {
      id,
      provider: 'mock_digilocker',
      providerRef: `mock_${randomUUID()}`,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      consentVersion: 'dev-draft',
    });
    return id;
  }

  const identity = (over: Partial<DigiLockerIdentity> = {}): DigiLockerIdentity => ({
    name: 'ASHA SHARMA',
    dateOfBirth: '1998-08-15',
    gender: 'female',
    digilockerId: `DL-${randomUUID()}`,
    ...over,
  });

  const profileOf = async (id: string) =>
    (
      await sql<{
        is_identity_verified: boolean;
        verified_gender: string | null;
        date_of_birth: string;
        category: string;
        biodata_completion: number;
      }>`select is_identity_verified, verified_gender, date_of_birth::text, category, biodata_completion
           from public.profiles where id = ${id}`.execute(db)
    ).rows[0]!;

  beforeAll(() => {
    db = createDatabase(url!, { max: 3 });
    repo = pgVerificationRepository(db, { hasher, cipher });
  });
  afterAll(async () => {
    if (users.length)
      await sql`delete from auth.users where id in (${sql.join(users)})`.execute(db); // cascades
    await db.destroy();
  });

  it('a start records the consent and opens one pending attempt; a new start replaces it', async () => {
    const u = await user();
    const first = await started(u);
    const second = await started(u);
    expect((await repo.get(u, first))!.status).toBe('expired');
    expect(await repo.get(u, second)).toMatchObject({
      status: 'pending',
      type: 'digilocker',
      failureCode: null,
    });
    expect((await repo.list(u)).map((v) => v.id)).toEqual([second, first]);
    const consent = await sql<{ n: number }>`select count(*)::int as n from public.consents
      where user_id = ${u} and purpose = 'identity_verification' and withdrawn_at is null`.execute(
      db,
    );
    expect(consent.rows[0]!.n).toBe(1);
    expect(await repo.get(randomUUID(), second)).toBeNull(); // not the owner
  });

  it('verified: encrypted identity record, DigiLocker DOB and gender, completion recomputed', async () => {
    const u = await user();
    const id = await started(u);
    const who = identity();
    expect(await repo.complete(id, who, { today: TODAY })).toEqual({
      status: 'verified',
      categoryChanged: false,
    });
    const p = await profileOf(u);
    expect(p).toMatchObject({
      is_identity_verified: true,
      verified_gender: 'female',
      date_of_birth: '1998-08-15',
    });
    // Recomputed on the write: basics (a date of birth) 10 + DigiLocker verified 5.
    expect(p.biodata_completion).toBe(15);
    const rec = await db
      .selectFrom('private.identity_records')
      .selectAll()
      .where('user_id', '=', u)
      .executeTakeFirstOrThrow();
    expect(cipher.decrypt(rec.verified_name_enc as Buffer)).toBe('ASHA SHARMA');
    expect((rec.verified_name_enc as Buffer).includes(Buffer.from('ASHA'))).toBe(false);
    expect((rec.digilocker_id_hash as Buffer).equals(hasher('digilocker', who.digilockerId))).toBe(
      true,
    );
    expect((await repo.get(u, id))!.status).toBe('verified');
    // A repeated webhook changes nothing.
    expect(await repo.complete(id, who, { today: TODAY })).toEqual({ status: 'not_pending' });
  });

  it('one DigiLocker identity per account', async () => {
    const who = identity();
    const a = await user();
    await repo.complete(await started(a), who, { today: TODAY });
    const b = await user();
    const id = await started(b);
    expect(await repo.complete(id, who, { today: TODAY })).toEqual({
      status: 'failed',
      failureCode: 'identity_in_use',
    });
    expect((await profileOf(b)).is_identity_verified).toBe(false);
  });

  it('women-only with a non-female result moves to professional and any flatmate', async () => {
    const u = await user({ name: 'Rahul', category: 'women_only', femaleOnly: true });
    const id = await started(u);
    expect(
      await repo.complete(id, identity({ name: 'RAHUL VERMA', gender: 'male' }), { today: TODAY }),
    ).toEqual({ status: 'verified', categoryChanged: true });
    expect(await profileOf(u)).toMatchObject({ category: 'professional', verified_gender: 'male' });
    const pref = await sql<{
      p: string;
    }>`select flatmate_gender_pref::text as p from public.preferences where user_id = ${u}`.execute(
      db,
    );
    expect(pref.rows[0]!.p).toBe('any');
  });

  it('women-only with a female result stays women-only', async () => {
    const u = await user({ category: 'women_only', femaleOnly: true });
    expect(await repo.complete(await started(u), identity(), { today: TODAY })).toEqual({
      status: 'verified',
      categoryChanged: false,
    });
    expect((await profileOf(u)).category).toBe('women_only');
  });

  it('failures: under 18, name mismatch, banned identity; the profile stays unverified', async () => {
    const minor = await user();
    const m = await started(minor);
    expect(
      await repo.complete(m, identity({ dateOfBirth: '2010-05-01' }), { today: TODAY }),
    ).toEqual({
      status: 'failed',
      failureCode: 'underage',
    });
    const other = await user({ name: 'Meera' });
    expect(await repo.complete(await started(other), identity(), { today: TODAY })).toEqual({
      status: 'failed',
      failureCode: 'name_mismatch',
    });
    const bannedId = `DL-${randomUUID()}`;
    await sql`insert into private.banned_identities (digilocker_id_hash, reason)
      values (${hasher('digilocker', bannedId)}, 'integration test')`.execute(db);
    const b = await user();
    const bId = await started(b);
    expect(
      await repo.complete(bId, identity({ digilockerId: bannedId }), { today: TODAY }),
    ).toEqual({
      status: 'failed',
      failureCode: 'banned',
    });
    await sql`delete from private.banned_identities where reason = 'integration test'`.execute(db);
    for (const u of [minor, other, b])
      expect((await profileOf(u)).is_identity_verified).toBe(false);
    expect(await repo.get(b, bId)).toMatchObject({ status: 'failed', failureCode: 'banned' });
  });

  it('a cancelled consent fails the attempt once; the provider reference finds pending attempts only', async () => {
    const u = await user();
    const ref = `mock_${randomUUID()}`;
    const id = randomUUID();
    await repo.start(u, {
      id,
      provider: 'mock_digilocker',
      providerRef: ref,
      expiresAt: new Date(Date.now() + 60_000),
      consentVersion: 'dev-draft',
    });
    expect(await repo.findPending('mock_digilocker', ref)).toEqual({ id, userId: u });
    expect(await repo.findPending('other_provider', ref)).toBeNull();
    expect(await repo.fail(id, 'user_cancelled')).toBe(true);
    expect(await repo.fail(id, 'user_cancelled')).toBe(false);
    expect(await repo.findPending('mock_digilocker', ref)).toBeNull();
  });

  it('a pending attempt past its expiry reads as expired', async () => {
    const u = await user();
    const id = randomUUID();
    await repo.start(u, {
      id,
      provider: 'mock_digilocker',
      providerRef: `mock_${randomUUID()}`,
      expiresAt: new Date(Date.now() - 1_000),
      consentVersion: 'dev-draft',
    });
    expect(await repo.get(u, id)).toMatchObject({ status: 'expired', failureCode: null });
  });
});
