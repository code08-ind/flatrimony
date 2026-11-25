/**
 * /v1/me HTTP behaviour (T2.5) against a fake repository: auth, validation, 18+, consents, bans,
 * women-only, student fields, idempotency and what is logged. The SQL itself is covered by
 * test/integration/me.db.test.ts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { memoryPhotoStorage } from '../src/lib/photo-storage.js';
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
  StoredPhoto,
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
  /** The DigiLocker verified name, when the test needs one (T3.1). */
  verifiedName?: string;
  versions: LegalVersions | null;
  phone: string | null;
  profile: (ProfileState & { row: BootstrapWrite['profile'] & ProfileUpdate }) | null;
  consents: ConsentRecord[];
  writes: BootstrapWrite[];
  updates: ProfileUpdate[];
  /** Another account already holding the caller's phone hash. */
  holder: { userId: string; phone: string | null; hash: Buffer } | null;
  repointed: { userId: string; hash: Buffer | null }[];
  /** Biodata writes the routes made: [part, body]. */
  biodata: [string, unknown][];
  /** Thrown by bootstrap (Postgres constraint errors). */
  dbError?: unknown;
  photos: StoredPhoto[];
}

function fakeRepo(state: FakeState): MeRepository {
  const touch = (ifVersion?: string) => {
    if (!state.profile) return false;
    if (ifVersion !== undefined && ifVersion !== state.profile.version) return false;
    state.profile.version = String(Number(state.profile.version) + 1);
    return true;
  };
  // Like lockAndTouch: refuses a stale version, otherwise records the write and bumps the version.
  const biodata = async (part: string, body: unknown, ifVersion?: string) => {
    if (!state.profile) return false;
    if (ifVersion !== undefined && ifVersion !== state.profile.version) return false;
    state.biodata.push([part, body]);
    state.profile.version = String(Number(state.profile.version) + 1);
    return true;
  };
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
    async activeAreaIds(ids) {
      return ids.filter((id) => id <= 10);
    },
    async activeScenarioQuestionIds(ids) {
      return ids.filter((id) => id.startsWith('q_'));
    },
    async replacePreferences(_id, p, v) {
      return biodata('preferences', p, v);
    },
    async setAnchor(_id, a, v) {
      return biodata('anchor', a, v);
    },
    async commuteZone() {
      return { anchor: null, zone: null, pending: false };
    },
    async removeAnchor(_id, v) {
      return biodata('anchor', null, v);
    },
    async replaceLifestyle(_id, l, v) {
      return biodata('lifestyle', l, v);
    },
    async replaceImportance(_id, m, v) {
      return biodata('importance', m, v);
    },
    async listPhotos() {
      return [...state.photos].sort((a, b) => a.position - b.position);
    },
    async addPhoto(_id, photo, v) {
      if (!touch(v)) return null;
      const old = state.photos.find((p) => p.position === photo.position);
      state.photos = state.photos.filter((p) => p !== old);
      const id = randomUUID();
      state.photos.push({
        id,
        storagePath: photo.storagePath,
        position: photo.position,
        moderationStatus: 'pending',
      });
      return { id, replacedPath: old?.storagePath ?? null };
    },
    async reorderPhotos(_id, ids, v) {
      if (v !== undefined && v !== state.profile?.version) return 'stale';
      if (
        ids.length !== state.photos.length ||
        !ids.every((id) => state.photos.some((p) => p.id === id))
      )
        return 'mismatch'; // rolled back: no version change
      touch();
      state.photos = ids.map((id, position) => ({
        ...state.photos.find((p) => p.id === id)!,
        position,
      }));
      return 'ok';
    },
    async deletePhoto(_id, photoId, v) {
      if (v !== undefined && v !== state.profile?.version) return 'stale';
      const target = state.photos.find((p) => p.id === photoId);
      if (!target) return 'not_found';
      if (state.photos.length <= 1) return 'last';
      touch();
      state.photos = state.photos
        .filter((p) => p !== target)
        .sort((a, b) => a.position - b.position)
        .map((p, position) => ({ ...p, position }));
      return { storagePath: target.storagePath };
    },
    async upsertScenarioAnswers(_id, a, v) {
      return biodata('scenarios', a, v);
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
  nowMs = NOW,
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
    biodata: [],
    photos: [],
    ...overrides,
  };
  const logs: string[] = [];
  const storage = memoryPhotoStorage();
  app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', HASH_PEPPER: PEPPER }),
    jwtVerifier: async (token) => {
      if (token !== 'a.b.c') throw new Error('bad token');
      return { id: USER, appRole: 'user' };
    },
    meRepo: fakeRepo(state),
    ...(state.verifiedName
      ? { verificationRepo: () => ({ verifiedName: async () => state.verifiedName! }) as never }
      : {}),
    photoStorage: storage,
    bansRepo: memoryBansRepository(banned),
    now: () => nowMs,
    logStream: { write: (line) => void logs.push(line) },
  });
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ) =>
    app!.inject({
      method,
      url,
      headers: { authorization: 'Bearer a.b.c' },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  return { state, logs, call, storage };
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

  it('a verified user’s new display name must still match the DigiLocker name (FR-VER-03)', async () => {
    const { call, state } = await setup({
      profile: existing(
        { isIdentityVerified: true, verifiedGender: 'female' },
        { displayName: 'Asha' },
      ),
      verifiedName: 'ASHA RANI SHARMA',
    });
    const res = await call('PATCH', '/v1/me', { displayName: 'Rahul' });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0]).toMatchObject({ path: 'body.displayName', code: 'name_mismatch' });
    expect((await call('PATCH', '/v1/me', { displayName: 'Rani' })).statusCode).toBe(200);
    expect(state.updates).toEqual([{ displayName: 'Rani' }]);
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

describe('biodata writes (T2.7)', () => {
  const profile = (over: Partial<ProfileState> = {}) => ({
    category: 'professional' as const,
    isIdentityVerified: false,
    verifiedGender: null,
    deleted: false,
    suspendedUntil: null,
    version: '3',
    ...over,
    row: {
      displayName: 'K',
      dateOfBirth: '2000-01-01',
      intent: 'need_room' as const,
      category: 'professional' as const,
      locale: 'en' as const,
    },
  });
  const prefs = (over: object = {}) => ({
    budgetMinInr: 10000,
    budgetMaxInr: 20000,
    moveInFrom: '2026-12-01',
    moveInTo: '2026-12-20',
    leaseMonths: 11,
    flatmateGenderPref: 'any',
    areaIds: [1, 2],
    ...over,
  });
  const anchor = (over: object = {}) => ({
    kind: 'office',
    label: 'Cyber City office',
    location: { lat: 28.495, lng: 77.089 },
    travelMode: 'metro_transit',
    maxCommuteMin: 45,
    ...over,
  });
  const lifestyle = {
    bedtime: '23:00',
    wakeTime: '07:00',
    cleaning: 'daily',
    smoking: 'no',
    pets: 'love',
    food: 'veg',
  };

  const routes = () =>
    [
      ['/v1/me/preferences', prefs()],
      ['/v1/me/anchor', anchor()],
      ['/v1/me/lifestyle', lifestyle],
      ['/v1/me/importance', { smoking: 'dealbreaker' }],
      ['/v1/me/scenario-answers', [{ questionId: 'q_sink', optionId: 'now' }]],
    ] as const;

  it('every route: 409 before bootstrap, 403 when suspended — even with an invalid body', async () => {
    const none = await setup();
    for (const [url, body] of routes()) {
      expect((await none.call('PUT', url, body)).statusCode, url).toBe(409);
    }
    // Profile checks come before request checks: an unknown area is still 409 here.
    expect(
      (await none.call('PUT', '/v1/me/preferences', prefs({ areaIds: [99] }))).statusCode,
    ).toBe(409);
    await app!.close();
    app = undefined;
    const suspended = await setup({
      profile: profile({ suspendedUntil: '2026-12-01T00:00:00.000Z' }),
    });
    for (const [url, body] of routes()) {
      const res = await suspended.call('PUT', url, body);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().code).toBe('account.suspended');
    }
    expect(suspended.state.biodata).toEqual([]);
  });

  it('every route: new ETag after the write; a stale If-Match is 412 and writes nothing', async () => {
    const { state } = await setup({ profile: profile() });
    let version = 3;
    for (const [url, body] of routes()) {
      const ok = await app!.inject({
        method: 'PUT',
        url,
        headers: { authorization: 'Bearer a.b.c', 'if-match': `W/"${version}"` },
        payload: body as object,
      });
      expect(ok.statusCode, url).toBe(200);
      version += 1;
      expect(ok.headers.etag, url).toBe(`W/"${version}"`);
      const stale = await app!.inject({
        method: 'PUT',
        url,
        headers: { authorization: 'Bearer a.b.c', 'if-match': 'W/"1"' },
        payload: body as object,
      });
      expect(stale.statusCode, url).toBe(412);
    }
    expect(state.biodata).toHaveLength(5);
  });

  it('PUT /me/preferences validates areas, the window and the budget', async () => {
    const { call, state } = await setup({ profile: profile() });
    const ok = await call('PUT', '/v1/me/preferences', prefs());
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers.etag).toBe('W/"4"'); // bumped by the write
    expect(state.biodata[0]).toEqual(['preferences', prefs()]);
    for (const [bad, code] of [
      [prefs({ areaIds: [1, 99] }), 'unknown_area'],
      [prefs({ moveInFrom: '2026-10-01', moveInTo: '2026-11-16' }), 'in_the_past'], // today is 17 Nov
      [prefs({ budgetMinInr: 30000, budgetMaxInr: 20000 }), undefined],
      [prefs({ areaIds: [1, 2, 3, 4] }), undefined],
      [prefs({ areaIds: [1, 1] }), undefined],
      [prefs({ moveInFrom: '2026-12-21' }), undefined],
      [prefs({ budgetMinInr: 999 }), undefined],
      [prefs({ leaseMonths: 37 }), undefined],
      [prefs({ extra: true }), undefined],
      [prefs({ areaIds: [40000] }), undefined], // beyond smallint: schema 422, not a DB 500
    ] as const) {
      const res = await call('PUT', '/v1/me/preferences', bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
      if (code) expect(res.json().errors.map((e: { code: string }) => e.code)).toContain(code);
    }
    // A window that ends today is still fine.
    expect(
      (
        await call(
          'PUT',
          '/v1/me/preferences',
          prefs({ moveInFrom: '2026-11-01', moveInTo: '2026-11-17' }),
        )
      ).statusCode,
    ).toBe(200);
  });

  it('GET /me/commute-zone: none before an office or college is set (T2.9)', async () => {
    const { call } = await setup({ profile: profile() });
    const res = await call('GET', '/v1/me/commute-zone');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'none',
      zone: null,
      approx: false,
      travelMode: null,
      maxCommuteMin: null,
      computedAt: null,
    });
  });

  it('POST /commute/preview: a zone for a place in NCR (approximate without routing)', async () => {
    const { call } = await setup({ profile: profile() });
    const res = await call('POST', '/v1/commute/preview', {
      location: { lat: 28.495, lng: 77.089 },
      travelMode: 'car',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.approx).toBe(true);
    expect(body.zone.type).toBe('MultiPolygon');
    expect(body.zone.coordinates[0][0]).toHaveLength(49);
    const mumbai = await call('POST', '/v1/commute/preview', {
      location: { lat: 19.07, lng: 72.88 },
      travelMode: 'car',
    });
    expect(mumbai.json().errors[0]).toMatchObject({ code: 'outside_ncr' });
    for (const bad of [
      { location: { lat: 28.5, lng: 77.1 }, travelMode: 'car', maxCommuteMin: 120 },
      { location: { lat: 28.5, lng: 77.1 }, travelMode: 'boat' },
      { location: { lat: 28.5, lng: 77.1 }, travelMode: 'car', extra: 1 },
    ])
      expect((await call('POST', '/v1/commute/preview', bad)).statusCode).toBe(422);
  });

  it('PUT /me/anchor needs a place in Delhi NCR', async () => {
    const { call, state } = await setup({ profile: profile() });
    expect((await call('PUT', '/v1/me/anchor', anchor())).statusCode).toBe(200);
    const mumbai = await call(
      'PUT',
      '/v1/me/anchor',
      anchor({ location: { lat: 19.07, lng: 72.88 } }),
    );
    expect(mumbai.statusCode).toBe(422);
    expect(mumbai.json().errors[0]).toMatchObject({ path: 'body.location', code: 'outside_ncr' });
    for (const bad of [
      anchor({ maxCommuteMin: 10 }),
      anchor({ maxCommuteMin: 95 }),
      anchor({ travelMode: 'helicopter' }),
      anchor({ label: '\u200b' }),
      anchor({ location: { lat: 91, lng: 77 } }),
    ])
      expect((await call('PUT', '/v1/me/anchor', bad)).statusCode, JSON.stringify(bad)).toBe(422);
    // maxCommuteMin defaults to 45 (FR-BIO-03).
    const noMax: Record<string, unknown> = anchor();
    delete noMax.maxCommuteMin;
    expect((await call('PUT', '/v1/me/anchor', noMax)).statusCode).toBe(200);
    expect((state.biodata.at(-1)![1] as { maxCommuteMin: number }).maxCommuteMin).toBe(45);
  });

  it('PUT /me/lifestyle needs the six core answers; times are HH:mm', async () => {
    const { call } = await setup({ profile: profile() });
    expect(
      (await call('PUT', '/v1/me/lifestyle', { ...lifestyle, drinking: 'rarely' })).statusCode,
    ).toBe(200);
    for (const bad of [
      { ...lifestyle, wakeTime: undefined },
      { ...lifestyle, bedtime: '24:00' },
      { ...lifestyle, bedtime: '11 PM' },
      { ...lifestyle, smoking: 'sometimes' },
      { ...lifestyle, mood: 'happy' },
    ])
      expect((await call('PUT', '/v1/me/lifestyle', bad)).statusCode, JSON.stringify(bad)).toBe(
        422,
      );
  });

  it('PUT /me/importance takes known attributes and levels only', async () => {
    const { call } = await setup({ profile: profile() });
    expect(
      (await call('PUT', '/v1/me/importance', { smoking: 'dealbreaker', pets: 'dont_care' }))
        .statusCode,
    ).toBe(200);
    expect((await call('PUT', '/v1/me/importance', {})).statusCode).toBe(200);
    expect((await call('PUT', '/v1/me/importance', { smoking: 'very' })).statusCode).toBe(422);
    expect((await call('PUT', '/v1/me/importance', { astrology: 'matters' })).statusCode).toBe(422);
  });

  it('PUT /me/scenario-answers: known questions, each once', async () => {
    const { call } = await setup({ profile: profile() });
    expect(
      (await call('PUT', '/v1/me/scenario-answers', [{ questionId: 'q_sink', optionId: 'now' }]))
        .statusCode,
    ).toBe(200);
    const unknown = await call('PUT', '/v1/me/scenario-answers', [
      { questionId: 'nope', optionId: 'x' },
    ]);
    expect(unknown.json().errors[0]).toMatchObject({
      path: 'body.0.questionId',
      code: 'unknown_question',
    });
    for (const bad of [
      [],
      [
        { questionId: 'q_a', optionId: 'x' },
        { questionId: 'q_a', optionId: 'y' },
      ],
      [{ questionId: 'q_a' }],
    ])
      expect(
        (await call('PUT', '/v1/me/scenario-answers', bad)).statusCode,
        JSON.stringify(bad),
      ).toBe(422);
  });

  it('the move-in window uses the date in India (20:00 UTC is already tomorrow)', async () => {
    // 2026-11-17 20:00 UTC = 18 Nov 01:30 IST: a window ending 17 Nov is over in India.
    const { call } = await setup({ profile: profile() }, {}, Date.parse('2026-11-17T20:00:00Z'));
    const res = await call(
      'PUT',
      '/v1/me/preferences',
      prefs({ moveInFrom: '2026-11-01', moveInTo: '2026-11-17' }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].code).toBe('in_the_past');
  });

  it('QA fixes: no session is 401 even with a bad body; location objects are strict', async () => {
    const { call } = await setup({ profile: profile() });
    for (const [method, url] of [
      ['PUT', '/v1/me/preferences'],
      ['PATCH', '/v1/me'],
      ['POST', '/v1/me/bootstrap'],
    ] as const) {
      const res = await app!.inject({ method, url, payload: { nonsense: true } });
      expect(res.statusCode, url).toBe(401);
    }
    const alt = await call(
      'PUT',
      '/v1/me/anchor',
      anchor({ location: { lat: 28.495, lng: 77.089, alt: 3 } }),
    );
    expect(alt.statusCode).toBe(422);
  });
});

describe('photos (T2.10)', () => {
  const profile = () => ({
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
  });
  const jpeg = () =>
    sharp({ create: { width: 640, height: 480, channels: 3, background: '#7a5' } })
      .withExif({ IFD0: { Make: 'TestCam' } })
      .jpeg()
      .toBuffer();

  async function upload(
    call: Awaited<ReturnType<typeof setup>>['call'],
    storage: Awaited<ReturnType<typeof setup>>['storage'],
    file: Buffer,
  ) {
    const res = await call('POST', '/v1/me/photos/upload-url', {
      contentType: 'image/jpeg',
      sizeBytes: file.length,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { storageKey } = res.json();
    storage.objects.set(storageKey, file); // the client PUTs the file to uploadUrl
    return storageKey as string;
  }

  it('upload URL: a per-user staging key, signed URL and expiry; size and type limits', async () => {
    const { call } = await setup({ profile: profile() });
    const res = await call('POST', '/v1/me/photos/upload-url', {
      contentType: 'image/webp',
      sizeBytes: 1000,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().storageKey).toMatch(new RegExp(`^${USER}/uploads/[0-9a-f-]{36}$`));
    expect(res.json().uploadUrl).toMatch(/^https:\/\//);
    expect(Date.parse(res.json().expiresAt)).toBe(NOW + 2 * 60 * 60 * 1000);
    for (const bad of [
      { contentType: 'image/png', sizeBytes: 1000 },
      { contentType: 'image/jpeg', sizeBytes: 8 * 1024 * 1024 + 1 },
      { contentType: 'image/jpeg', sizeBytes: 0 },
    ])
      expect(
        (await call('POST', '/v1/me/photos/upload-url', bad)).statusCode,
        JSON.stringify(bad),
      ).toBe(422);
  });

  it('confirm: processed WebP without metadata, staging copy removed, Me lists it with a signed URL', async () => {
    const { call, storage, state } = await setup({ profile: profile() });
    const key = await upload(call, storage, await jpeg());
    const res = await call('POST', '/v1/me/photos', { storageKey: key, position: 0 });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ position: 0, moderationStatus: 'pending' });
    expect(storage.objects.has(key)).toBe(false);
    const stored = state.photos[0]!.storagePath;
    expect(stored).toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}\\.webp$`));
    const meta = await sharp(storage.objects.get(stored)!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    const me = (await call('GET', '/v1/me')).json();
    expect(me.photos).toEqual([
      {
        id: state.photos[0]!.id,
        url: expect.stringContaining(encodeURIComponent(stored)),
        position: 0,
        moderationStatus: 'pending',
      },
    ]);
  });

  it("confirm: refuses other users' keys, missing uploads and non-photos", async () => {
    const { call, storage } = await setup({ profile: profile() });
    const other = `${randomUUID()}/uploads/${randomUUID()}`;
    storage.objects.set(other, await jpeg());
    expect(
      (await call('POST', '/v1/me/photos', { storageKey: other, position: 0 })).json().errors[0]
        .code,
    ).toBe('invalid_key');
    expect(
      (
        await call('POST', '/v1/me/photos', {
          storageKey: `${USER}/${randomUUID()}.webp`,
          position: 0,
        })
      ).json().errors[0].code,
    ).toBe('invalid_key');
    const missing = await call('POST', '/v1/me/photos', {
      storageKey: `${USER}/uploads/${randomUUID()}`,
      position: 0,
    });
    expect(missing.json().errors[0].code).toBe('upload_missing');
    const text = await upload(call, storage, Buffer.from('not a photo at all'));
    const res = await call('POST', '/v1/me/photos', { storageKey: text, position: 0 });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].code).toBe('unsupported_format');
    expect(storage.objects.has(text)).toBe(false); // the rejected upload is removed
    expect(
      (await call('POST', '/v1/me/photos', { storageKey: text, position: 6 })).statusCode,
    ).toBe(422);
  });

  it('confirm on an occupied position replaces the photo and removes the old object', async () => {
    const { call, storage, state } = await setup({ profile: profile() });
    await call('POST', '/v1/me/photos', {
      storageKey: await upload(call, storage, await jpeg()),
      position: 0,
    });
    const first = state.photos[0]!.storagePath;
    await call('POST', '/v1/me/photos', {
      storageKey: await upload(call, storage, await jpeg()),
      position: 0,
    });
    expect(state.photos).toHaveLength(1);
    expect(state.photos[0]!.storagePath).not.toBe(first);
    expect(storage.objects.has(first)).toBe(false);
  });

  it("order and delete: exactly the user's photos; never the last one", async () => {
    const { call, storage, state } = await setup({ profile: profile() });
    for (const position of [0, 1, 2])
      await call('POST', '/v1/me/photos', {
        storageKey: await upload(call, storage, await jpeg()),
        position,
      });
    const [a, b, c] = [...state.photos].sort((x, y) => x.position - y.position).map((p) => p.id);
    const ordered = await call('PATCH', '/v1/me/photos/order', { photoIds: [c, a, b] });
    expect(ordered.statusCode, ordered.body).toBe(200);
    expect(ordered.json().photos.map((p: { id: string }) => p.id)).toEqual([c, a, b]);
    expect((await call('PATCH', '/v1/me/photos/order', { photoIds: [c, a] })).statusCode).toBe(422);
    expect(
      (await call('PATCH', '/v1/me/photos/order', { photoIds: [c, a, randomUUID()] })).statusCode,
    ).toBe(422);
    expect((await call('PATCH', '/v1/me/photos/order', { photoIds: [c, c, a] })).statusCode).toBe(
      422,
    );

    const removedPath = state.photos.find((p) => p.id === a)!.storagePath;
    expect((await call('DELETE', `/v1/me/photos/${a}`)).statusCode).toBe(204);
    expect(storage.objects.has(removedPath)).toBe(false);
    expect(
      [...state.photos].sort((x, y) => x.position - y.position).map((p) => [p.id, p.position]),
    ).toEqual([
      [c, 0],
      [b, 1],
    ]);
    expect((await call('DELETE', `/v1/me/photos/${randomUUID()}`)).statusCode).toBe(404);
    await call('DELETE', `/v1/me/photos/${b}`);
    const last = await call('DELETE', `/v1/me/photos/${c}`);
    expect(last.statusCode).toBe(409);
    expect(last.json().title).toMatch(/at least one/);
  });

  it('without storage the photo routes answer 503 and Me has no photos', async () => {
    const state = {
      versions: VERSIONS,
      phone: null,
      profile: profile(),
      consents: [],
      writes: [],
      updates: [],
      holder: null,
      repointed: [],
      biodata: [],
      photos: [],
    } satisfies FakeState;
    app = await buildApp({
      env: loadEnv({ NODE_ENV: 'test', HASH_PEPPER: PEPPER }),
      jwtVerifier: async () => ({ id: USER, appRole: 'user' }),
      meRepo: fakeRepo(state),
      now: () => NOW,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/me/photos/upload-url',
      headers: { authorization: 'Bearer a.b.c' },
      payload: { contentType: 'image/jpeg', sizeBytes: 10 },
    });
    expect(res.statusCode).toBe(503);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer a.b.c' },
    });
    expect(me.json().photos).toEqual([]);
  });

  it('review fixes: early If-Match, position gaps, Location and ETag, stale-upload sweep', async () => {
    const { call, storage, state } = await setup({ profile: profile() });
    const key = await upload(call, storage, await jpeg());
    // A stale or malformed If-Match is refused before any download or image work.
    const stale = await app!.inject({
      method: 'POST',
      url: '/v1/me/photos',
      headers: { authorization: 'Bearer a.b.c', 'if-match': 'W/"0"' },
      payload: { storageKey: key, position: 0 },
    });
    expect(stale.statusCode).toBe(412);
    expect(storage.objects.has(key)).toBe(true); // untouched: the app may retry
    const bad = await app!.inject({
      method: 'POST',
      url: '/v1/me/photos',
      headers: { authorization: 'Bearer a.b.c', 'if-match': 'nope' },
      payload: { storageKey: key, position: 0 },
    });
    expect(bad.statusCode).toBe(422);
    // Photos fill 0..n-1.
    const gap = await call('POST', '/v1/me/photos', { storageKey: key, position: 1 });
    expect(gap.json().errors[0].code).toBe('position_gap');
    const ok = await call('POST', '/v1/me/photos', { storageKey: key, position: 0 });
    expect(ok.statusCode).toBe(201);
    expect(ok.headers.location).toBe('/v1/me');
    expect(ok.headers.etag).toMatch(/^W\/"\d+"$/);
    await call('POST', '/v1/me/photos', {
      storageKey: await upload(call, storage, await jpeg()),
      position: 1,
    });
    const del = await call('DELETE', `/v1/me/photos/${state.photos[1]!.id}`);
    expect(del.statusCode).toBe(204);
    expect(del.headers.etag).toBe(`W/"${state.profile!.version}"`);

    // upload-url removes this user's unconfirmed uploads older than the 2 h URL lifetime.
    const old = `${USER}/uploads/${randomUUID()}`;
    const fresh = `${USER}/uploads/${randomUUID()}`;
    storage.objects.set(old, Buffer.from('x'));
    storage.created.set(old, NOW - 2 * 60 * 60 * 1000 - 1);
    storage.objects.set(fresh, Buffer.from('y'));
    storage.created.set(fresh, NOW - 60_000);
    await call('POST', '/v1/me/photos/upload-url', { contentType: 'image/jpeg', sizeBytes: 10 });
    expect(storage.objects.has(old)).toBe(false);
    expect(storage.objects.has(fresh)).toBe(true);
  });

  it('a Storage outage leaves photos out of Me instead of failing', async () => {
    const { call, storage, state } = await setup({ profile: profile() });
    await call('POST', '/v1/me/photos', {
      storageKey: await upload(call, storage, await jpeg()),
      position: 0,
    });
    expect(state.photos).toHaveLength(1);
    storage.signedUrls = async () => {
      throw new Error('storage down');
    };
    const me = await call('GET', '/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().photos).toEqual([]);
    expect((await call('PATCH', '/v1/me', { bio: 'still works' })).statusCode).toBe(200);
  });

  it('logs no storage paths or tokens while handling photos', async () => {
    const { call, storage, logs } = await setup({ profile: profile() });
    storage.remove = async () => {
      throw new Error('cleanup failed for a/uploads/b');
    };
    const key = await upload(call, storage, await jpeg());
    await call('POST', '/v1/me/photos', { storageKey: key, position: 0 });
    const all = logs.join('\n');
    expect(all).not.toContain(key);
    expect(all).not.toContain('.webp');
    expect(all).not.toContain('token=');
  });
});
