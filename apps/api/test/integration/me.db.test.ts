/**
 * /v1/me against Postgres with migrations + dev seed (T2.5): rows written by bootstrap, hashes,
 * idempotency, Me mapping, biodata completion and consents. Skipped without DATABASE_URL.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { Me } from '@flatrimony/shared';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { createDatabase, type Database } from '../../src/lib/db.js';
import { createIdentifierHasher } from '../../src/lib/hashing.js';
import { pgBansRepository } from '../../src/modules/auth/bans.js';
import { pgMeRepository } from '../../src/modules/me/repository.js';

const url = process.env.DATABASE_URL;
const PEPPER = randomBytes(32).toString('base64');
const hasher = createIdentifierHasher(PEPPER);

describe.skipIf(!url)('/v1/me on Postgres', () => {
  let db: Database;
  let app: FastifyInstance;
  const users: { id: string; phone: string; token: string }[] = [];

  async function newUser() {
    const id = randomUUID();
    const phone = `9198${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    await sql`insert into auth.users (id, aud, role, phone) values (${id}, 'authenticated', 'authenticated', ${phone})`.execute(
      db,
    );
    const user = { id, phone, token: `t.${users.length}.x` };
    users.push(user);
    return user;
  }
  const call = (
    user: { token: string },
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${user.token}` },
      ...(payload ? { payload } : {}),
    });
  const body = (deviceId: string, over: object = {}) => ({
    displayName: 'Karan',
    dateOfBirth: '2002-04-18',
    intent: 'need_room',
    category: 'professional',
    locale: 'hi',
    consents: [
      { purpose: 'terms', version: 'dev-draft' },
      { purpose: 'privacy', version: 'dev-draft' },
    ],
    device: {
      deviceId,
      platform: 'android',
      appVersion: '1.0.0',
      pushToken: 'ExponentPushToken[it]',
      integrityToken: 'header.payload.sig',
    },
    ...over,
  });

  beforeAll(async () => {
    db = createDatabase(url!, { max: 3 });
    app = await buildApp({
      env: loadEnv({ NODE_ENV: 'test', HASH_PEPPER: PEPPER }),
      jwtVerifier: async (token) => {
        const user = users.find((u) => u.token === token);
        if (!user) throw new Error('unknown');
        return { id: user.id, appRole: 'user' };
      },
      meRepo: pgMeRepository(db),
      bansRepo: pgBansRepository(db),
    });
  });
  afterAll(async () => {
    await app.close();
    if (users.length)
      await sql`delete from auth.users where id = any(${users.map((u) => u.id)}::uuid[])`.execute(
        db,
      );
    await sql`delete from private.banned_identities where reason = 'me integration test'`.execute(
      db,
    );
    await db.destroy();
  });

  it('bootstrap writes profile, phone hash, consents and device; a retry changes nothing', async () => {
    const user = await newUser();
    const deviceId = `install-${randomUUID()}`;
    const first = await call(user, 'POST', '/v1/me/bootstrap', body(deviceId));
    expect(first.statusCode, first.body).toBe(201);
    const me = Me.parse(first.json());
    expect(me).toMatchObject({
      id: user.id,
      displayName: 'Karan',
      intent: 'need_room',
      category: 'professional',
      locale: 'hi',
      languages: [],
      isIdentityVerified: false,
      badges: [],
      isPaused: false,
      biodataCompletion: 10, // basics only
      photos: [],
      importance: {},
      entitlements: { movePass: { active: false } },
    });
    expect(me.age).toBeGreaterThanOrEqual(24);

    const contact = await db
      .selectFrom('private.user_contact')
      .select('phone_hash')
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(contact.phone_hash.equals(hasher('phone', `+${user.phone}`))).toBe(true);

    const consents = await db
      .selectFrom('consents')
      .select(['purpose', 'version', 'withdrawn_at'])
      .where('user_id', '=', user.id)
      .orderBy('purpose')
      .execute();
    expect(consents).toEqual([
      { purpose: 'terms', version: 'dev-draft', withdrawn_at: null },
      { purpose: 'privacy', version: 'dev-draft', withdrawn_at: null },
    ]);

    const devices = await db
      .selectFrom('devices')
      .selectAll()
      .where('user_id', '=', user.id)
      .execute();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      platform: 'android',
      app_version: '1.0.0',
      push_token: 'ExponentPushToken[it]',
      integrity_verdict: 'unverified',
    });
    expect(devices[0]!.device_hash.equals(hasher('device', deviceId))).toBe(true);
    // The integrity token and the raw ids are stored nowhere.
    expect(JSON.stringify(devices)).not.toContain('header.payload.sig');

    const again = await call(
      user,
      'POST',
      '/v1/me/bootstrap',
      body(deviceId, { displayName: 'Other' }),
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().displayName).toBe('Karan');
    expect(
      await db.selectFrom('devices').select('id').where('user_id', '=', user.id).execute(),
    ).toHaveLength(1);
  });

  it('a banned device cannot create an account (FR-AUTH-08)', async () => {
    const user = await newUser();
    const deviceId = `install-${randomUUID()}`;
    await sql`insert into private.banned_identities (device_hash, reason) values (${hasher('device', deviceId)}, 'me integration test')`.execute(
      db,
    );
    const res = await call(user, 'POST', '/v1/me/bootstrap', body(deviceId));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('auth.banned');
    expect(
      await db.selectFrom('profiles').select('id').where('id', '=', user.id).execute(),
    ).toEqual([]);
  });

  it('GET /me maps biodata, and the six onboarding parts reach 40 % (FR-AUTH-06 AC)', async () => {
    const user = await newUser();
    expect(
      (await call(user, 'POST', '/v1/me/bootstrap', body(`install-${randomUUID()}`))).statusCode,
    ).toBe(201);
    // What T2.7's endpoints will write; inserted directly here.
    await sql`insert into public.preferences (user_id, budget_min_inr, budget_max_inr, move_in_from, move_in_to)
              values (${user.id}, 15000, 20000, '2026-12-01', '2026-12-20')`.execute(db);
    await sql`insert into public.anchors (user_id, kind, label, location, travel_mode, max_commute_min)
              values (${user.id}, 'office', 'Cyber City office', st_point(77.089, 28.495)::geography, 'metro_transit', 40)`.execute(
      db,
    );
    await sql`insert into public.lifestyle (user_id, bedtime, wake_time, cleaning, smoking, pets, food, drinking)
              values (${user.id}, '23:30', '07:00', 'daily', 'no', 'love', 'veg', 'rarely')`.execute(
      db,
    );
    await sql`insert into public.lifestyle_importance (user_id, attribute, importance)
              values (${user.id}, 'smoking', 'dealbreaker')`.execute(db);

    // Any write recomputes the completion.
    const patched = await call(user, 'PATCH', '/v1/me', { languages: ['hi', 'en'] });
    expect(patched.statusCode, patched.body).toBe(200);
    const me = Me.parse(patched.json());
    expect(me.biodataCompletion).toBe(40 + 5 + 10); // onboarding 40, languages 5, importance 10
    expect(me.preferences).toEqual({
      budgetMinInr: 15000,
      budgetMaxInr: 20000,
      moveInFrom: '2026-12-01',
      moveInTo: '2026-12-20',
      leaseMonths: 11,
      flatmateGenderPref: 'any',
      areaIds: [],
    });
    expect(me.anchor).toEqual({
      kind: 'office',
      label: 'Cyber City office',
      location: { lat: 28.495, lng: 77.089 },
      travelMode: 'metro_transit',
      maxCommuteMin: 40,
    });
    expect(me.lifestyle).toEqual({
      bedtime: '23:30',
      wakeTime: '07:00',
      cleaning: 'daily',
      smoking: 'no',
      pets: 'love',
      food: 'veg',
      drinking: 'rarely',
    });
    expect(me.importance).toEqual({ smoking: 'dealbreaker' });
  });

  it('PATCH writes through, clears nullable fields and keeps DB rules', async () => {
    const user = await newUser();
    await call(user, 'POST', '/v1/me/bootstrap', body(`install-${randomUUID()}`));
    let res = await call(user, 'PATCH', '/v1/me', {
      bio: 'Product designer, early riser.',
      category: 'student',
      collegeName: 'Delhi University',
      courseEndDate: '2028-05-31',
      isPaused: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      bio: 'Product designer, early riser.',
      category: 'student',
      collegeName: 'Delhi University',
      courseEndDate: '2028-05-31',
      isPaused: true,
      biodataCompletion: 20,
    });
    res = await call(user, 'PATCH', '/v1/me', { bio: null, category: 'professional' });
    expect(res.statusCode).toBe(200);
    expect(res.json().bio).toBeUndefined();
    expect(res.json().collegeName).toBeUndefined();
    expect(res.json().biodataCompletion).toBe(10);
  });

  it('consents: list, grant, withdraw and grant again', async () => {
    const user = await newUser();
    await call(user, 'POST', '/v1/me/bootstrap', body(`install-${randomUUID()}`));
    expect(
      (await call(user, 'POST', '/v1/me/consents', { purpose: 'analytics', version: 'dev-draft' }))
        .statusCode,
    ).toBe(201);
    // Granting the active version again changes nothing (200, same grant).
    expect(
      (await call(user, 'POST', '/v1/me/consents', { purpose: 'analytics', version: 'dev-draft' }))
        .statusCode,
    ).toBe(200);
    expect((await call(user, 'DELETE', '/v1/me/consents/analytics')).statusCode).toBe(204);

    let list = (await call(user, 'GET', '/v1/me/consents')).json();
    expect(list.currentVersions).toMatchObject({ terms: 'dev-draft', privacy: 'dev-draft' });
    const analytics = list.consents.filter((c: { purpose: string }) => c.purpose === 'analytics');
    expect(analytics).toHaveLength(1);
    expect(analytics[0].withdrawnAt).toEqual(expect.any(String));

    const regrant = await call(user, 'POST', '/v1/me/consents', {
      purpose: 'analytics',
      version: 'dev-draft',
    });
    expect(regrant.statusCode).toBe(201);
    expect(regrant.json().withdrawnAt).toBeUndefined();
    list = (await call(user, 'GET', '/v1/me/consents')).json();
    // Append-only (DPDP evidence): the withdrawn grant stays on record next to the new one.
    const history = list.consents.filter((c: { purpose: string }) => c.purpose === 'analytics');
    expect(history).toHaveLength(2);
    expect(history.filter((c: { withdrawnAt?: string }) => c.withdrawnAt)).toHaveLength(1);
    expect((await call(user, 'DELETE', '/v1/me/consents/terms')).statusCode).toBe(409);
  });

  it('a retried bootstrap keeps the original consent times', async () => {
    const user = await newUser();
    const deviceId = `install-${randomUUID()}`;
    await call(user, 'POST', '/v1/me/bootstrap', body(deviceId));
    const before = await db
      .selectFrom('consents')
      .select(['id', 'granted_at'])
      .where('user_id', '=', user.id)
      .orderBy('id')
      .execute();
    await new Promise((r) => setTimeout(r, 20));
    expect((await call(user, 'POST', '/v1/me/bootstrap', body(deviceId))).statusCode).toBe(200);
    const after = await db
      .selectFrom('consents')
      .select(['id', 'granted_at'])
      .where('user_id', '=', user.id)
      .orderBy('id')
      .execute();
    expect(after).toEqual(before);
  });

  it('two bootstraps at once create one profile (one 201, one 200), no error', async () => {
    const user = await newUser();
    const deviceId = `install-${randomUUID()}`;
    const results = await Promise.all([
      call(user, 'POST', '/v1/me/bootstrap', body(deviceId)),
      call(user, 'POST', '/v1/me/bootstrap', body(deviceId)),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const counts = await sql<{ consents: number; devices: number }>`
      select (select count(*)::int from public.consents where user_id = ${user.id}) as consents,
             (select count(*)::int from public.devices where user_id = ${user.id}) as devices`.execute(
      db,
    );
    expect(counts.rows[0]).toEqual({ consents: 2, devices: 1 });
  });

  it('a shared installation hands its push token to the new account only', async () => {
    const a = await newUser();
    const b = await newUser();
    const deviceId = `install-${randomUUID()}`;
    await call(a, 'POST', '/v1/me/bootstrap', body(deviceId));
    await call(b, 'POST', '/v1/me/bootstrap', body(deviceId));
    const rows = await db
      .selectFrom('devices')
      .select(['user_id', 'push_token'])
      .where('user_id', 'in', [a.id, b.id])
      .execute();
    expect(rows.find((r) => r.user_id === a.id)!.push_token).toBeNull();
    expect(rows.find((r) => r.user_id === b.id)!.push_token).toBe('ExponentPushToken[it]');
  });
});
