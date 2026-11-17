/**
 * /v1/me HTTP behaviour (T2.5) against a fake repository: auth, validation, 18+, consents, bans,
 * women-only, student fields, idempotency and what is logged. The SQL itself is covered by
 * test/integration/me.db.test.ts.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Me, type ConsentGrant, type ConsentRecord } from '@flatrimony/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createIdentifierHasher } from '../src/lib/hashing.js';
import { memoryBansRepository } from '../src/modules/auth/bans.js';
import type {
  BootstrapWrite,
  LegalVersions,
  MeRepository,
  ProfileState,
  ProfileUpdate,
} from '../src/modules/me/repository.js';
import { consentErrors, istToday } from '../src/modules/me/routes.js';

const USER = '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
const PHONE = '+919812345678';
const DEVICE = 'install-0f8e2c7a9b';
const PEPPER = randomBytes(32).toString('base64');
const hasher = createIdentifierHasher(PEPPER);
// 2026-11-17 10:00 IST
const NOW = Date.parse('2026-11-17T04:30:00Z');
const VERSIONS: LegalVersions = {
  terms: '2026-11-01',
  privacy: '2026-11-01',
  analytics: '2026-11-01',
};

interface FakeState {
  versions: LegalVersions | null;
  phone: string | null;
  profile: (ProfileState & { row: BootstrapWrite['profile'] & ProfileUpdate }) | null;
  consents: ConsentRecord[];
  writes: BootstrapWrite[];
  updates: ProfileUpdate[];
  /** Another account already holding the caller's phone hash. */
  holder: { userId: string; phone: string | null; hash: Buffer } | null;
  repointed: { userId: string; hash: Buffer | null }[];
  /** Thrown by bootstrap (Postgres constraint errors). */
  dbError?: unknown;
}

function fakeRepo(state: FakeState): MeRepository {
  return {
    async legalVersions() {
      return state.versions;
    },
    async phoneOf() {
      return state.phone;
    },
    async profileState() {
      return state.profile;
    },
    async bootstrap(_id, write) {
      if (state.holder?.hash.equals(write.phoneHash))
        throw Object.assign(new Error('duplicate'), {
          code: '23505',
          constraint: 'user_contact_phone_hash_key',
        });
      if (state.dbError) throw state.dbError;
      state.writes.push(write);
      const created = !state.profile;
      if (created)
        state.profile = {
          category: write.profile.category,
          isIdentityVerified: false,
          verifiedGender: null,
          deleted: false,
          suspendedUntil: null,
          version: '1',
          row: { ...write.profile },
        };
      return { created };
    },
    async loadMe(id) {
      const p = state.profile;
      if (!p) return null;
      return Me.parse({
        id,
        displayName: p.row.displayName,
        age: 24,
        intent: p.row.intent,
        category: p.category,
        languages: p.row.languages ?? [],
        locale: p.row.locale,
        ...(p.row.collegeName ? { collegeName: p.row.collegeName } : {}),
        isIdentityVerified: p.isIdentityVerified,
        badges: [],
        isPaused: p.row.isPaused ?? false,
        biodataCompletion: 10,
        photos: [],
        importance: {},
        entitlements: { movePass: { active: false } },
        createdAt: '2026-11-17T04:30:00.000Z',
      });
    },
    async updateProfile(_id, update, ifVersion) {
      if (!state.profile) return false;
      if (ifVersion !== undefined && ifVersion !== state.profile.version) return false;
      state.updates.push(update);
      state.profile.row = { ...state.profile.row, ...update } as typeof state.profile.row;
      if (update.category) state.profile.category = update.category;
      state.profile.version = String(Number(state.profile.version) + 1);
      return true;
    },
    async phoneHashHolder(hash) {
      return state.holder && state.holder.hash.equals(hash) ? state.holder : null;
    },
    async setPhoneHash(userId, hash) {
      state.repointed.push({ userId, hash });
      state.holder = null;
    },
    async listConsents() {
      return state.consents;
    },
    async grantConsent(_id, grant: ConsentGrant) {
      const active = state.consents.find(
        (c) => c.purpose === grant.purpose && c.version === grant.version && !c.withdrawnAt,
      );
      if (active) return { record: active, created: false };
      const record = { ...grant, grantedAt: '2026-11-17T04:30:00.000Z' };
      state.consents.push(record);
      return { record, created: true };
    },
    async withdrawConsent() {
      return true;
    },
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(
  overrides: Partial<FakeState> = {},
  banned: { phone?: Buffer[]; device?: Buffer[] } = {},
) {
  const state: FakeState = {
    versions: VERSIONS,
    phone: PHONE.slice(1), // auth.users stores it without '+'
    profile: null,
    consents: [],
    writes: [],
    updates: [],
    holder: null,
    repointed: [],
    ...overrides,
  };
  const logs: string[] = [];
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', HASH_PEPPER: PEPPER }),
    jwtVerifier: async (token) => {
      if (token !== 'a.b.c') throw new Error('bad token');
      return { id: USER, appRole: 'user' };
    },
    meRepo: fakeRepo(state),
    bansRepo: memoryBansRepository(banned),
    now: () => NOW,
    logStream: { write: (line) => void logs.push(line) },
  });
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app!.inject({
      method,
      url,
      headers: { authorization: 'Bearer a.b.c' },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  return { state, logs, call };
}

const bootstrapBody = (over: Record<string, unknown> = {}) => ({
  displayName: 'Karan',
  dateOfBirth: '2002-04-18',
  intent: 'need_room',
  category: 'professional',
  locale: 'en',
  consents: [
    { purpose: 'terms', version: '2026-11-01' },
    { purpose: 'privacy', version: '2026-11-01' },
  ],
  device: { deviceId: DEVICE, platform: 'android', appVersion: '1.0.0' },
  ...over,
});

describe('POST /v1/me/bootstrap', () => {
  it('needs an OTP session', async () => {
    await setup();
    const res = await app!.inject({
      method: 'POST',
      url: '/v1/me/bootstrap',
      payload: bootstrapBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates the profile (201), then answers 200 with the same profile (idempotent)', async () => {
    const { call, state } = await setup();
    const first = await call('POST', '/v1/me/bootstrap', bootstrapBody());
    expect(first.statusCode).toBe(201);
    expect(Me.parse(first.json()).displayName).toBe('Karan');
    const again = await call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({ displayName: 'Someone else' }),
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().displayName).toBe('Karan');

    // Identifiers are hashed with the API pepper; the phone is the verified one, never the body's.
    const write = state.writes[0]!;
    expect(write.phoneHash.equals(hasher('phone', PHONE))).toBe(true);
    expect(write.device.deviceHash.equals(hasher('device', DEVICE))).toBe(true);
    expect(write.device.integrityVerdict).toBe('unverified');
    expect(write.consents.map((c) => c.purpose)).toEqual(['terms', 'privacy']);
  });

  it('refuses under-18s with profile.underage, counting age in India', async () => {
    const { call } = await setup();
    // 18 on 2026-11-18: still 17 on 17 Nov in India.
    const minor = await call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({ dateOfBirth: '2008-11-18' }),
    );
    expect(minor.statusCode).toBe(422);
    expect(minor.json().code).toBe('profile.underage');
    // Turns 18 today (17 Nov in India): allowed.
    const adult = await call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({ dateOfBirth: '2008-11-17' }),
    );
    expect(adult.statusCode).toBe(201);
  });

  it('uses the Indian date for the 18+ rule', () => {
    expect(istToday(Date.parse('2026-11-16T19:00:00Z'))).toBe('2026-11-17'); // 00:30 IST
    expect(istToday(Date.parse('2026-11-16T18:00:00Z'))).toBe('2026-11-16'); // 23:30 IST
  });

  it('rejects impossible dates of birth as validation errors', async () => {
    const { call } = await setup();
    for (const dob of ['1899-12-31', '2002-02-30', '18-04-2002']) {
      const res = await call('POST', '/v1/me/bootstrap', bootstrapBody({ dateOfBirth: dob }));
      expect(res.statusCode, dob).toBe(422);
      expect(res.json().code, dob).toBe('validation.failed');
    }
  });

  it('requires the current Terms and Privacy versions', async () => {
    const { call, state } = await setup();
    const missing = await call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({ consents: [{ purpose: 'terms', version: '2026-11-01' }] }),
    );
    expect(missing.statusCode).toBe(422);
    expect(missing.json().errors).toEqual([
      expect.objectContaining({ path: 'body.consents', code: 'consent_required' }),
    ]);

    const outdated = await call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({
        consents: [
          { purpose: 'terms', version: '2026-01-01' },
          { purpose: 'privacy', version: '2026-11-01' },
        ],
      }),
    );
    expect(outdated.statusCode).toBe(422);
    expect(outdated.json().errors[0]).toMatchObject({
      path: 'body.consents.0.version',
      code: 'consent_version_outdated',
    });

    const unknown = await call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({
        consents: [
          { purpose: 'terms', version: '2026-11-01' },
          { purpose: 'privacy', version: '2026-11-01' },
          { purpose: 'marketing', version: '2026-11-01' },
        ],
      }),
    );
    expect(unknown.json().errors[0]).toMatchObject({ code: 'consent_not_offered' });

    const duplicate = await call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({
        consents: [
          { purpose: 'terms', version: '2026-11-01' },
          { purpose: 'terms', version: '2026-11-01' },
        ],
      }),
    );
    expect(duplicate.statusCode).toBe(422);
    expect(state.writes).toHaveLength(0);
  });

  it('is closed (503) while the legal documents are unpublished', async () => {
    const { call } = await setup({ versions: null });
    const res = await call('POST', '/v1/me/bootstrap', bootstrapBody());
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('upstream.unavailable');
  });

  it('refuses banned phones and banned devices (FR-AUTH-08) without saying which', async () => {
    for (const banned of [
      { phone: [hasher('phone', PHONE)] },
      { device: [hasher('device', DEVICE)] },
    ]) {
      const { call, state } = await setup({}, banned);
      const res = await call('POST', '/v1/me/bootstrap', bootstrapBody());
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('auth.banned');
      expect(state.writes).toHaveLength(0);
      await app!.close();
      app = undefined;
    }
  });

  it('needs a verified phone on the auth user', async () => {
    const { call } = await setup({ phone: null });
    expect((await call('POST', '/v1/me/bootstrap', bootstrapBody())).statusCode).toBe(409);
  });

  it('accepts women_only before verification', async () => {
    const { call } = await setup();
    const res = await call('POST', '/v1/me/bootstrap', bootstrapBody({ category: 'women_only' }));
    expect(res.statusCode).toBe(201);
    expect(res.json().category).toBe('women_only');
  });

  it('rejects unknown fields and Aadhaar-style extras (strict body)', async () => {
    const { call } = await setup();
    const res = await call('POST', '/v1/me/bootstrap', bootstrapBody({ aadhaar: '1234' }));
    expect(res.statusCode).toBe(422);
  });

  it('refuses a deleted account', async () => {
    const { call } = await setup({
      profile: {
        category: 'professional',
        isIdentityVerified: false,
        verifiedGender: null,
        deleted: true,
        suspendedUntil: null,
        version: '1',
        row: {
          displayName: 'K',
          dateOfBirth: '2000-01-01',
          intent: 'need_room',
          category: 'professional',
          locale: 'en',
        },
      },
    });
    const res = await call('POST', '/v1/me/bootstrap', bootstrapBody());
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('auth.account_deleted');
  });

  it('never logs the phone number, device id or push token', async () => {
    const { call, logs } = await setup();
    await call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({
        device: {
          deviceId: DEVICE,
          platform: 'android',
          appVersion: '1.0.0',
          pushToken: 'ExponentPushToken[secret-push]',
        },
      }),
    );
    const all = logs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [PHONE, PHONE.slice(1), DEVICE, 'secret-push'])
      expect(all).not.toContain(secret);
  });
});

describe('GET and PATCH /v1/me', () => {
  const existing = (over: Partial<ProfileState> = {}, row: Partial<ProfileUpdate> = {}) => ({
    category: 'professional' as const,
    isIdentityVerified: false,
    verifiedGender: null,
    deleted: false,
    suspendedUntil: null,
    version: '7',
    ...over,
    row: {
      displayName: 'Karan',
      dateOfBirth: '2002-04-18',
      intent: 'need_room' as const,
      category: (over.category ?? 'professional') as 'professional',
      locale: 'en' as const,
      ...row,
    },
  });

  it('409 profile.incomplete before bootstrap', async () => {
    const { call } = await setup();
    const res = await call('GET', '/v1/me');
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('profile.incomplete');
    expect((await call('PATCH', '/v1/me', { bio: 'Hi' })).statusCode).toBe(409);
  });

  it('returns the Me contract', async () => {
    const { call } = await setup({ profile: existing() });
    const res = await call('GET', '/v1/me');
    expect(res.statusCode).toBe(200);
    expect(Me.parse(res.json()).id).toBe(USER);
  });

  it('updates allowed fields only', async () => {
    const { call, state } = await setup({ profile: existing() });
    const ok = await call('PATCH', '/v1/me', {
      displayName: 'Karan S',
      languages: ['hi', 'en'],
      isPaused: true,
    });
    expect(ok.statusCode).toBe(200);
    expect(state.updates[0]).toEqual({
      displayName: 'Karan S',
      languages: ['hi', 'en'],
      isPaused: true,
    });
    for (const bad of [
      {},
      { dateOfBirth: '1990-01-01' }, // not editable here (DigiLocker replaces it)
      { verifiedGender: 'female' },
      { isIdentityVerified: true },
      { languages: ['hi', 'hi'] },
      { languages: ['hin'] },
      { displayName: '\u200b' },
      { bio: 'x'.repeat(301) },
    ]) {
      const res = await call('PATCH', '/v1/me', bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect(state.updates).toHaveLength(1);
  });

  it('women_only: allowed before verification, refused for a verified non-female', async () => {
    const before = await setup({ profile: existing() });
    expect((await before.call('PATCH', '/v1/me', { category: 'women_only' })).statusCode).toBe(200);
    await app!.close();
    app = undefined;
    const verifiedMale = await setup({
      profile: existing({ isIdentityVerified: true, verifiedGender: 'male' }),
    });
    const res = await verifiedMale.call('PATCH', '/v1/me', { category: 'women_only' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('profile.category_not_allowed');
  });

  it('college fields only for students; leaving the student category clears them', async () => {
    const pro = await setup({ profile: existing() });
    const res = await pro.call('PATCH', '/v1/me', { collegeName: 'IIT Delhi' });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0]).toMatchObject({ path: 'body.collegeName', code: 'student_only' });
    expect(
      (
        await pro.call('PATCH', '/v1/me', {
          category: 'student',
          collegeName: 'IIT Delhi',
          courseEndDate: '2028-05-31',
        })
      ).statusCode,
    ).toBe(200);
    await app!.close();
    app = undefined;

    const student = await setup({
      profile: existing({ category: 'student' }, { collegeName: 'IIT Delhi' }),
    });
    expect((await student.call('PATCH', '/v1/me', { category: 'professional' })).statusCode).toBe(
      200,
    );
    expect(student.state.updates.at(-1)).toEqual({
      category: 'professional',
      collegeName: null,
      courseEndDate: null,
    });
  });
});

describe('/v1/me/consents', () => {
  const profile = {
    category: 'professional' as const,
    isIdentityVerified: false,
    verifiedGender: null,
    deleted: false,
    suspendedUntil: null,
    version: '1',
    row: {
      displayName: 'K',
      dateOfBirth: '2000-01-01',
      intent: 'need_room' as const,
      category: 'professional' as const,
      locale: 'en' as const,
    },
  };

  it('lists grants with the current versions', async () => {
    const { call } = await setup({
      profile,
      consents: [
        { purpose: 'terms', version: '2026-11-01', grantedAt: '2026-11-17T04:30:00.000Z' },
      ],
    });
    const res = await call('GET', '/v1/me/consents');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      consents: [
        { purpose: 'terms', version: '2026-11-01', grantedAt: '2026-11-17T04:30:00.000Z' },
      ],
      currentVersions: VERSIONS,
    });
  });

  it('grants only the current version of an offered purpose', async () => {
    const { call } = await setup({ profile });
    expect(
      (await call('POST', '/v1/me/consents', { purpose: 'analytics', version: '2026-11-01' }))
        .statusCode,
    ).toBe(201);
    const old = await call('POST', '/v1/me/consents', {
      purpose: 'analytics',
      version: '2025-01-01',
    });
    expect(old.statusCode).toBe(422);
    expect(old.json().errors[0]).toMatchObject({
      path: 'body.version',
      code: 'consent_version_outdated',
    });
    const notOffered = await call('POST', '/v1/me/consents', {
      purpose: 'marketing',
      version: '2026-11-01',
    });
    expect(notOffered.statusCode).toBe(422);
  });

  it('optional consents can be withdrawn; Terms and Privacy only by deleting the account', async () => {
    const { call } = await setup({ profile });
    expect((await call('DELETE', '/v1/me/consents/analytics')).statusCode).toBe(204);
    for (const p of ['terms', 'privacy']) {
      const res = await call('DELETE', `/v1/me/consents/${p}`);
      expect(res.statusCode).toBe(409);
      expect(res.json().detail).toMatch(/deleting the account/);
    }
    expect((await call('DELETE', '/v1/me/consents/aadhaar')).statusCode).toBe(422);
  });
});

describe('consentErrors', () => {
  it('reports each problem once, with a field path', () => {
    expect(consentErrors([], VERSIONS, { requireAll: true }).map((e) => e.code)).toEqual([
      'consent_required',
      'consent_required',
    ]);
    expect(
      consentErrors(
        [
          { purpose: 'terms', version: '2026-11-01' },
          { purpose: 'privacy', version: '2026-11-01' },
        ],
        VERSIONS,
        { requireAll: true },
      ),
    ).toEqual([]);
  });
});

describe('review fixes (T2.5)', () => {
  const profile = (over: Partial<ProfileState> = {}) => ({
    category: 'professional' as const,
    isIdentityVerified: false,
    verifiedGender: null,
    deleted: false,
    suspendedUntil: null,
    version: '7',
    ...over,
    row: {
      displayName: 'K',
      dateOfBirth: '2000-01-01',
      intent: 'need_room' as const,
      category: 'professional' as const,
      locale: 'en' as const,
    },
  });

  it('a suspended account can read and withdraw, but not write (403 account.suspended)', async () => {
    const until = '2026-11-20T00:00:00.000Z';
    const { call, state } = await setup({ profile: profile({ suspendedUntil: until }) });
    expect((await call('GET', '/v1/me')).statusCode).toBe(200);
    for (const [method, url, payload] of [
      ['PATCH', '/v1/me', { bio: 'hi' }],
      ['POST', '/v1/me/consents', { purpose: 'analytics', version: '2026-11-01' }],
      ['POST', '/v1/me/bootstrap', bootstrapBody()],
    ] as const) {
      const res = await call(method, url, payload);
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ code: 'account.suspended', suspendedUntil: until });
    }
    expect((await call('DELETE', '/v1/me/consents/analytics')).statusCode).toBe(204);
    expect(state.updates).toEqual([]);
  });

  it('GET /me sends an ETag; PATCH honours If-Match (412 when stale)', async () => {
    const { call } = await setup({ profile: profile() });
    const get = await call('GET', '/v1/me');
    expect(get.headers.etag).toBe('W/"7"');
    const stale = await app!.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: 'Bearer a.b.c', 'if-match': 'W/"6"' },
      payload: { bio: 'x' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('precondition.failed');
    const ok = await app!.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: 'Bearer a.b.c', 'if-match': 'W/"7"' },
      payload: { bio: 'x' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('W/"8"');
    const garbage = await app!.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: 'Bearer a.b.c', 'if-match': 'W/"abc"' },
      payload: { bio: 'x' },
    });
    expect(garbage.statusCode).toBe(422);
    // `*` matches whatever version exists (RFC 9110).
    const any = await app!.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: 'Bearer a.b.c', 'if-match': '*' },
      payload: { bio: 'y' },
    });
    expect(any.statusCode).toBe(200);
  });

  it('QA fixes: invisible names, NUL bytes, broken characters, unknown-key errors', async () => {
    const { call, state } = await setup({ profile: profile() });
    for (const bad of [
      { displayName: '\u3164' }, // Hangul filler renders blank
      { displayName: 'A\u2800' }, // Braille blank
      { displayName: 'a\ud800b' }, // lone surrogate
      { bio: 'a\u0000b' },
      { bio: 'x\u202Ey' }, // bidi override
      { bio: 'a\udc00' },
    ]) {
      const res = await call('PATCH', '/v1/me', bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect((await call('PATCH', '/v1/me', { bio: 'Line one\nLine two' })).statusCode).toBe(200);
    expect((await call('PATCH', '/v1/me', { displayName: 'अर्जुन 🙂' })).statusCode).toBe(200);

    const strict = await call('PATCH', '/v1/me', { dateOfBirth: '2000-01-01', bio: 'ok' });
    expect(strict.statusCode).toBe(422);
    expect(strict.json().errors).toEqual([
      { path: 'body.dateOfBirth', code: 'unrecognized_keys', message: 'Unknown field' },
    ]);
    const empty = await call('PATCH', '/v1/me', {});
    expect(empty.json().errors).toEqual([
      { path: 'body', code: 'empty', message: 'Nothing to change' },
    ]);
    expect(state.updates).toHaveLength(2);
  });

  it('push tokens are printable ASCII; text Postgres cannot store is a 422, not a 500', async () => {
    const boot = await setup();
    const res = await boot.call(
      'POST',
      '/v1/me/bootstrap',
      bootstrapBody({
        device: {
          deviceId: DEVICE,
          platform: 'android',
          appVersion: '1.0.0',
          pushToken: 'Expo\u0000x',
        },
      }),
    );
    expect(res.statusCode).toBe(422);
    await app!.close();
    app = undefined;

    const { call } = await setup({
      dbError: Object.assign(new Error('invalid byte sequence'), {
        code: '22021',
        severity: 'ERROR',
      }),
    });
    const db = await call('POST', '/v1/me/bootstrap', bootstrapBody());
    expect(db.statusCode).toBe(422);
    expect(db.json().code).toBe('validation.failed');
  });

  it('201 carries Location; granting an active consent again is 200', async () => {
    const boot = await setup();
    const created = await boot.call('POST', '/v1/me/bootstrap', bootstrapBody());
    expect(created.headers.location).toBe('/v1/me');
    expect(
      (await boot.call('POST', '/v1/me/consents', { purpose: 'analytics', version: '2026-11-01' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await boot.call('POST', '/v1/me/consents', { purpose: 'analytics', version: '2026-11-01' }))
        .statusCode,
    ).toBe(200);
  });

  it('maps database rules to catalogue codes', async () => {
    for (const [constraint, code, status] of [
      ['profiles_adult_chk', 'profile.underage', 422],
      ['profiles_women_only_chk', 'profile.category_not_allowed', 403],
    ] as const) {
      const { call } = await setup({
        dbError: Object.assign(new Error('check'), { code: '23514', constraint }),
      });
      const res = await call('POST', '/v1/me/bootstrap', bootstrapBody());
      expect(res.statusCode, constraint).toBe(status);
      expect(res.json().code).toBe(code);
      await app!.close();
      app = undefined;
    }
  });

  it('a number still on another account is 409; a reassigned number moves the old hash', async () => {
    const mine = hasher('phone', PHONE);
    const other = await setup({ holder: { userId: 'u-old', phone: PHONE.slice(1), hash: mine } });
    expect((await other.call('POST', '/v1/me/bootstrap', bootstrapBody())).statusCode).toBe(409);
    expect(other.state.repointed).toEqual([]);
    await app!.close();
    app = undefined;

    // The holder changed number since; the old number was reassigned to the caller.
    const moved = await setup({ holder: { userId: 'u-old', phone: '919876543210', hash: mine } });
    expect((await moved.call('POST', '/v1/me/bootstrap', bootstrapBody())).statusCode).toBe(201);
    expect(moved.state.repointed).toHaveLength(1);
    expect(moved.state.repointed[0]!.hash!.equals(hasher('phone', '+919876543210'))).toBe(true);
  });
});
