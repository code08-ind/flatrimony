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
import { memoryPhotoStorage } from '../../src/lib/photo-storage.js';
import sharp from 'sharp';

const url = process.env.DATABASE_URL;
/** A date `n` days from today (India), so the tests never age into the past. */
const inDays = (n: number) =>
  new Date(Date.now() + (5.5 * 60 + n * 24 * 60) * 60_000).toISOString().slice(0, 10);
const PEPPER = randomBytes(32).toString('base64');
const hasher = createIdentifierHasher(PEPPER);

describe.skipIf(!url)('/v1/me on Postgres', () => {
  const storage = memoryPhotoStorage();
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
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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
      photoStorage: storage,
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

  it('biodata PUTs (T2.7): onboarding through the API alone reaches 40 %', async () => {
    const user = await newUser();
    await call(user, 'POST', '/v1/me/bootstrap', body(`install-${randomUUID()}`));
    const areas = await db
      .selectFrom('ref.areas')
      .select('id')
      .where('is_active', '=', true)
      .orderBy('id')
      .limit(2)
      .execute();
    const areaIds = areas.map((a) => a.id);

    let res = await call(user, 'PUT', '/v1/me/preferences', {
      budgetMinInr: 10000,
      budgetMaxInr: 20000,
      moveInFrom: inDays(30),
      moveInTo: inDays(50),
      leaseMonths: 11,
      flatmateGenderPref: 'any',
      areaIds,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().preferences.areaIds).toEqual(areaIds);
    expect(res.json().biodataCompletion).toBe(30); // basics + preferences + areas

    // Replace semantics: the area set is replaced, not merged.
    res = await call(user, 'PUT', '/v1/me/preferences', {
      ...res.json().preferences,
      areaIds: [areaIds[1]],
    });
    expect(res.json().preferences.areaIds).toEqual([areaIds[1]]);

    res = await call(user, 'PUT', '/v1/me/lifestyle', {
      bedtime: '23:00',
      wakeTime: '07:30',
      cleaning: 'weekly',
      smoking: 'outside_only',
      pets: 'ok',
      food: 'eggetarian',
      drinking: 'sometimes',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().biodataCompletion).toBe(40); // FR-AUTH-06 AC
    // PUT replaces: optional answers not sent are cleared.
    res = await call(user, 'PUT', '/v1/me/lifestyle', {
      bedtime: '23:00',
      wakeTime: '07:30',
      cleaning: 'weekly',
      smoking: 'outside_only',
      pets: 'ok',
      food: 'eggetarian',
    });
    expect(res.json().lifestyle.drinking).toBeUndefined();
  });

  it('anchor, importance and scenario answers round-trip through Postgres', async () => {
    const user = await newUser();
    await call(user, 'POST', '/v1/me/bootstrap', body(`install-${randomUUID()}`));
    let res = await call(user, 'PUT', '/v1/me/anchor', {
      kind: 'college',
      label: 'North Campus',
      location: { lat: 28.6889, lng: 77.2106 },
      travelMode: 'two_wheeler',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().anchor).toEqual({
      kind: 'college',
      label: 'North Campus',
      location: { lat: 28.6889, lng: 77.2106 },
      travelMode: 'two_wheeler',
      maxCommuteMin: 45,
    });
    expect(res.json().biodataCompletion).toBe(20); // basics + anchor

    res = await call(user, 'PUT', '/v1/me/importance', {
      smoking: 'dealbreaker',
      pets: 'dont_care',
    });
    expect(res.json().importance).toEqual({ smoking: 'dealbreaker', pets: 'dont_care' });
    res = await call(user, 'PUT', '/v1/me/importance', { food: 'matters' });
    expect(res.json().importance).toEqual({ food: 'matters' }); // replaced

    const q = await db
      .selectFrom('ref.scenario_questions')
      .select(['id', 'options'])
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .executeTakeFirstOrThrow();
    const options = q.options as { id: string }[];
    res = await call(user, 'PUT', '/v1/me/scenario-answers', [
      { questionId: q.id, optionId: options[0]!.id },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    // Answering again replaces the earlier answer.
    res = await call(user, 'PUT', '/v1/me/scenario-answers', [
      { questionId: q.id, optionId: options[1]!.id },
    ]);
    const stored = await db
      .selectFrom('scenario_answers')
      .select('option_id')
      .where('user_id', '=', user.id)
      .execute();
    expect(stored).toEqual([{ option_id: options[1]!.id }]);
    // Me lists the answers (T2.11: the editor's "n of N answered").
    expect((await call(user, 'GET', '/v1/me')).json().scenarioAnswers).toEqual([
      { questionId: q.id, optionId: options[1]!.id },
    ]);

    // The database trigger refuses an option the question does not have.
    const bad = await call(user, 'PUT', '/v1/me/scenario-answers', [
      { questionId: q.id, optionId: 'not_an_option' },
    ]);
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].code).toBe('invalid_option');
  });

  it('review fixes (T2.7): inactive refs, commute zone, ETag, concurrency', async () => {
    const user = await newUser();
    await call(user, 'POST', '/v1/me/bootstrap', body(`install-${randomUUID()}`));
    // Fixtures of our own (inactive area and question), removed at the end.
    const area = await sql<{ id: number }>`
      insert into ref.areas (slug, name_en, name_hi, city, centroid, is_active)
      values (${`it-inactive-${randomInt(1e9)}`}, 'Closed', 'Closed', 'delhi', extensions.st_point(77.2, 28.6)::extensions.geography, false)
      returning id`.execute(db);
    const qid = `it_inactive_${randomInt(1e9)}`;
    await sql`insert into ref.scenario_questions (id, attribute, prompt_en, prompt_hi, options, is_active)
      values (${qid}, 'cleaning', 'Q', 'Q', '[{"id":"a","label_en":"A","label_hi":"A","value":0},{"id":"b","label_en":"B","label_hi":"B","value":1}]'::jsonb, false)`.execute(
      db,
    );
    try {
      const prefs = {
        budgetMinInr: 10000,
        budgetMaxInr: 20000,
        moveInFrom: inDays(10),
        moveInTo: inDays(20),
        leaseMonths: 11,
        flatmateGenderPref: 'any',
        areaIds: [area.rows[0]!.id],
      };
      const inactive = await call(user, 'PUT', '/v1/me/preferences', prefs);
      expect(inactive.statusCode).toBe(422);
      expect(inactive.json().errors[0].code).toBe('unknown_area');
      const q = await call(user, 'PUT', '/v1/me/scenario-answers', [
        { questionId: qid, optionId: 'a' },
      ]);
      expect(q.statusCode).toBe(422);
      expect(q.json().errors[0].code).toBe('unknown_question');

      // The ETag changes on every write, even when completion stays the same.
      const first = await call(user, 'PUT', '/v1/me/preferences', { ...prefs, areaIds: [] });
      const second = await call(user, 'PUT', '/v1/me/preferences', {
        ...prefs,
        areaIds: [],
        budgetMaxInr: 25000,
      });
      expect(first.json().biodataCompletion).toBe(second.json().biodataCompletion);
      expect(second.headers.etag).not.toBe(first.headers.etag);
      // A stale If-Match is refused and changes nothing.
      const stale = await app.inject({
        method: 'PUT',
        url: '/v1/me/preferences',
        headers: {
          authorization: `Bearer ${user.token}`,
          'if-match': first.headers.etag as string,
        },
        payload: { ...prefs, areaIds: [], budgetMaxInr: 30000 },
      });
      expect(stale.statusCode).toBe(412);
      expect((await call(user, 'GET', '/v1/me')).json().preferences.budgetMaxInr).toBe(25000);

      // A new anchor drops the old commute zone (recomputed by commute.compute, T2.9).
      await call(user, 'PUT', '/v1/me/anchor', {
        kind: 'office',
        label: 'Office',
        location: { lat: 28.495, lng: 77.089 },
        travelMode: 'car',
      });
      await sql`insert into public.commute_zones (user_id, travel_mode, max_minutes, zone)
        values (${user.id}, 'car', 45, extensions.st_multi(extensions.st_buffer(extensions.st_point(77.089, 28.495)::extensions.geography, 1000)::extensions.geometry)::extensions.geography)`.execute(
        db,
      );
      await call(user, 'PUT', '/v1/me/anchor', {
        kind: 'office',
        label: 'New office',
        location: { lat: 28.627, lng: 77.365 },
        travelMode: 'car',
      });
      const zones = await db
        .selectFrom('commute_zones')
        .select('user_id')
        .where('user_id', '=', user.id)
        .execute();
      expect(zones).toEqual([]);

      // Renaming the anchor keeps a matching zone; a new travel mode drops it.
      const zone = sql`insert into public.commute_zones (user_id, travel_mode, max_minutes, zone)
        values (${user.id}, 'car', 45, extensions.st_multi(extensions.st_buffer(extensions.st_point(77.365, 28.627)::extensions.geography, 1000)::extensions.geometry)::extensions.geography)`;
      await zone.execute(db);
      const anchorBody = {
        kind: 'office',
        label: 'Renamed office',
        location: { lat: 28.627, lng: 77.365 },
        travelMode: 'car',
      };
      await call(user, 'PUT', '/v1/me/anchor', anchorBody);
      const kept = await db
        .selectFrom('commute_zones')
        .select('user_id')
        .where('user_id', '=', user.id)
        .execute();
      expect(kept).toHaveLength(1);
      await call(user, 'PUT', '/v1/me/anchor', { ...anchorBody, travelMode: 'metro_transit' });
      const dropped = await db
        .selectFrom('commute_zones')
        .select('user_id')
        .where('user_id', '=', user.id)
        .execute();
      expect(dropped).toEqual([]);

      // Concurrent importance replacements for one user: serialised, never a 500.
      const results = await Promise.all(
        [
          { smoking: 'dealbreaker' },
          { pets: 'dont_care' },
          { food: 'matters' },
          { smoking: 'matters', pets: 'matters' },
        ].map((m) => call(user, 'PUT', '/v1/me/importance', m)),
      );
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    } finally {
      await sql`delete from ref.areas where id = ${area.rows[0]!.id}`.execute(db);
      await sql`delete from ref.scenario_questions where id = ${qid}`.execute(db);
    }
  });

  it('photos (T2.10): stored rows match the database rules; order, replace, delete; +20 %', async () => {
    const user = await newUser();
    await call(user, 'POST', '/v1/me/bootstrap', body(`install-${randomUUID()}`));
    const jpeg = (bg: string) =>
      sharp({ create: { width: 900, height: 600, channels: 3, background: bg } })
        .jpeg()
        .toBuffer();
    const add = async (position: number, bg: string) => {
      const url = await call(user, 'POST', '/v1/me/photos/upload-url', {
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      });
      const key = url.json().storageKey as string;
      storage.objects.set(key, await jpeg(bg));
      const res = await call(user, 'POST', '/v1/me/photos', { storageKey: key, position });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().id as string;
    };
    const a = await add(0, '#335');
    const b = await add(1, '#a53');
    const c = await add(2, '#3a5');

    const rows = await db
      .selectFrom('profile_photos')
      .select([
        'id',
        'position',
        'storage_path',
        'width',
        'height',
        'phash',
        'moderation_status',
        'has_face',
      ])
      .where('user_id', '=', user.id)
      .orderBy('position')
      .execute();
    expect(rows.map((r) => r.id)).toEqual([a, b, c]);
    for (const r of rows) {
      // The CHECK constraint (docs/04 §6.2) accepted the path; dimensions and hash are stored.
      expect(r.storage_path).toMatch(new RegExp(`^${user.id}/[0-9a-f-]{36}\\.webp$`));
      expect({ w: r.width, h: r.height }).toEqual({ w: 900, h: 600 });
      expect(r.phash).toMatch(/^[01]{64}$/);
      expect(r.moderation_status).toBe('pending');
      expect(r.has_face).toBeNull(); // face check Blocked (vendor)
    }
    let me = (await call(user, 'GET', '/v1/me')).json();
    expect(me.biodataCompletion).toBe(30); // basics 10 + photos 20
    expect(me.photos.map((p: { id: string }) => p.id)).toEqual([a, b, c]);

    // Reorder through the unique (user, position) constraint.
    const res = await call(user, 'PATCH', '/v1/me/photos/order', { photoIds: [c, b, a] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().photos.map((p: { id: string }) => p.id)).toEqual([c, b, a]);

    // Replace position 0 (c): the old object is removed.
    const oldPath = rows.find((r) => r.id === c)!.storage_path;
    const d = await add(0, '#999');
    expect(storage.objects.has(oldPath)).toBe(false);
    me = (await call(user, 'GET', '/v1/me')).json();
    expect(me.photos.map((p: { id: string }) => p.id)).toEqual([d, b, a]);

    // Delete closes the gap; the last photo stays.
    expect((await call(user, 'DELETE', `/v1/me/photos/${b}`)).statusCode).toBe(204);
    me = (await call(user, 'GET', '/v1/me')).json();
    expect(me.photos.map((p: { id: string; position: number }) => [p.id, p.position])).toEqual([
      [d, 0],
      [a, 1],
    ]);
    await call(user, 'DELETE', `/v1/me/photos/${a}`);
    expect((await call(user, 'DELETE', `/v1/me/photos/${d}`)).statusCode).toBe(409);

    // A refused reorder or delete changes nothing, not even the ETag (QA T2.10 F1).
    const etag = (await call(user, 'GET', '/v1/me')).headers.etag;
    expect(
      (await call(user, 'PATCH', '/v1/me/photos/order', { photoIds: [randomUUID()] })).statusCode,
    ).toBe(422);
    expect((await call(user, 'DELETE', `/v1/me/photos/${randomUUID()}`)).statusCode).toBe(404);
    expect((await call(user, 'DELETE', `/v1/me/photos/${d}`)).statusCode).toBe(409);
    expect((await call(user, 'GET', '/v1/me')).headers.etag).toBe(etag);
  });
});
