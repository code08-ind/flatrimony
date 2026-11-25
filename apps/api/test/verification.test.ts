import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Verification, VerificationFailureCode } from '@flatrimony/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createFieldCipher, parseFieldKey } from '../src/lib/field-crypto.js';
import { signWebhook } from '../src/lib/standard-webhooks.js';
import type { ProfileState } from '../src/modules/me/repository.js';
import { decideOutcome, firstNameMatches } from '../src/modules/verification/outcome.js';
import {
  DigiLockerUnavailable,
  mockDigiLockerProvider,
  type DigiLockerIdentity,
  type DigiLockerProvider,
} from '../src/modules/verification/provider.js';
import type {
  CompleteOutcome,
  VerificationRepository,
} from '../src/modules/verification/repository.js';

const USER = '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
const OTHER = '7c1e9a2b-4d3f-4e5a-8b6c-0d1e2f3a4b5c';
const NOW = Date.parse('2026-11-24T06:00:00Z');
const KEY = randomBytes(32);
const SECRET = `v1,whsec_${KEY.toString('base64')}`;

describe('first name match (FR-VER-03)', () => {
  it.each([
    ['Asha', 'ASHA RANI SHARMA', true],
    ['asha', 'Sharma Asha', true], // any word of the DigiLocker name
    ['Abhi', 'ABHISHEK KUMAR', true], // a short form of at least 3 letters
    ['Priyanka', 'PRIYA SINGH', true],
    ['Renée', 'RENEE DSOUZA', true], // Latin accents ignored
    ['आशा', 'आशा शर्मा', true], // Devanagari kept whole
    ['Raj', 'RAJESH', true],
    ['Al', 'ALOK VERMA', false], // too short to be a short form
    ['Meera', 'ASHA SHARMA', false],
    ['', 'ASHA', false],
    ['Asha', '', false],
  ])('%s vs %s → %s', (display, verified, ok) => {
    expect(firstNameMatches(display, verified)).toBe(ok);
  });
});

describe('deciding a result', () => {
  const base = {
    displayName: 'Asha',
    verifiedName: 'ASHA SHARMA',
    dateOfBirth: '1998-08-15',
    today: '2026-11-24',
    banned: false,
    inUseElsewhere: false,
  };
  it('verified when everything holds', () => {
    expect(decideOutcome(base)).toBeNull();
  });
  it('checks in order: banned, then age, then someone else’s account, then the name', () => {
    const all = {
      ...base,
      banned: true,
      dateOfBirth: '2010-01-01',
      inUseElsewhere: true,
      displayName: 'Meera',
    };
    expect(decideOutcome(all)).toBe('banned');
    expect(decideOutcome({ ...all, banned: false })).toBe('underage');
    expect(decideOutcome({ ...all, banned: false, dateOfBirth: base.dateOfBirth })).toBe(
      'identity_in_use',
    );
    expect(decideOutcome({ ...base, displayName: 'Meera' })).toBe('name_mismatch');
  });
  it('18 on today’s date in India is enough; a day short is not', () => {
    expect(decideOutcome({ ...base, dateOfBirth: '2008-11-24' })).toBeNull();
    expect(decideOutcome({ ...base, dateOfBirth: '2008-11-25' })).toBe('underage');
  });
  it('a nonsense date is a provider error', () => {
    for (const dateOfBirth of ['1890-01-01', '15/08/1998', ''])
      expect(decideOutcome({ ...base, dateOfBirth })).toBe('provider_error');
  });
});

describe('field encryption', () => {
  const cipher = createFieldCipher(randomBytes(32));
  it('round-trips, with a fresh IV each time, in the stored layout', () => {
    const a = cipher.encrypt('आशा शर्मा');
    const b = cipher.encrypt('आशा शर्मा');
    expect(a.equals(b)).toBe(false);
    expect(a[0]).toBe(1);
    expect(a.length).toBe(1 + 12 + Buffer.byteLength('आशा शर्मा') + 16);
    expect(cipher.decrypt(a)).toBe('आशा शर्मा');
  });
  it('refuses tampered data, another key and unknown versions', () => {
    const stored = cipher.encrypt('ASHA SHARMA');
    const flipped = Buffer.from(stored);
    flipped[15] = flipped[15]! ^ 1;
    expect(() => cipher.decrypt(flipped)).toThrow();
    expect(() => createFieldCipher(randomBytes(32)).decrypt(stored)).toThrow();
    const v2 = Buffer.from(stored);
    v2[0] = 2;
    expect(() => cipher.decrypt(v2)).toThrow(/format/);
  });
  it('keys are v1:<base64 of 32 bytes>', () => {
    const raw = randomBytes(32).toString('base64');
    expect(parseFieldKey(`v1:${raw}`).length).toBe(32);
    for (const bad of [raw, `v2:${raw}`, `v1:${randomBytes(16).toString('base64')}`, 'v1:%%%'])
      expect(() => parseFieldKey(bad)).toThrow();
  });
});

describe('the mock provider', () => {
  it('starts a session with an opaque reference and returns the tester’s choice', async () => {
    const mock = mockDigiLockerProvider({ publicApiUrl: 'http://localhost:8080/', now: () => NOW });
    const s = await mock.start({ verificationId: 'v1' });
    expect(s.providerRef).toMatch(/^mock_[0-9a-f-]{36}$/);
    expect(s.redirectUrl).toBe(`http://localhost:8080/dev/digilocker/${s.providerRef}`);
    expect(s.expiresAt.getTime()).toBe(NOW + 10 * 60_000);
    expect(await mock.result(s.providerRef)).toEqual({ state: 'pending' });
    expect(mock.complete(s.providerRef, { cancelled: true })).toBe(true);
    expect(mock.complete(s.providerRef, { cancelled: true })).toBe(false); // once
    expect(await mock.result(s.providerRef)).toEqual({ state: 'failed', reason: 'user_cancelled' });
    expect(await mock.result('mock_00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await mock.result('../etc')).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------ routes

const identity: DigiLockerIdentity = {
  name: 'ASHA SHARMA',
  dateOfBirth: '1998-08-15',
  gender: 'female',
  digilockerId: 'DL-1234-5678',
};

/** What the owner sees of a stored attempt. */
const toPublic = (r: Verification): Verification => ({
  id: r.id,
  type: r.type,
  status: r.status,
  failureCode: r.failureCode,
  startedAt: r.startedAt,
  completedAt: r.completedAt,
  expiresAt: r.expiresAt,
});

/** An in-memory repository: records what the routes ask for. */
function memoryRepo() {
  const rows = new Map<string, Verification & { userId: string; providerRef: string }>();
  const completed: { id: string; identity: DigiLockerIdentity; today: string }[] = [];
  const consents: { userId: string; version: string }[] = [];
  let outcome: CompleteOutcome = { status: 'verified', categoryChanged: false };
  const repo: VerificationRepository = {
    async start(userId, w) {
      consents.push({ userId, version: w.consentVersion });
      for (const r of rows.values())
        if (r.userId === userId && r.status === 'pending') r.status = 'expired';
      rows.set(w.id, {
        id: w.id,
        userId,
        providerRef: w.providerRef,
        type: 'digilocker',
        status: 'pending',
        failureCode: null,
        startedAt: new Date(NOW).toISOString(),
        completedAt: null,
        expiresAt: w.expiresAt.toISOString(),
      });
    },
    async get(userId, id) {
      const r = rows.get(id);
      if (!r || r.userId !== userId) return null;
      return toPublic(r);
    },
    async list(userId) {
      return [...rows.values()].filter((r) => r.userId === userId).map(toPublic);
    },
    async findPending(_provider, providerRef) {
      const r = [...rows.values()].find(
        (x) => x.providerRef === providerRef && x.status === 'pending',
      );
      return r ? { id: r.id, userId: r.userId } : null;
    },
    async fail(id, code) {
      const r = rows.get(id);
      if (!r || r.status !== 'pending') return false;
      Object.assign(r, { status: 'failed', failureCode: code });
      return true;
    },
    async complete(id, given, { today }) {
      completed.push({ id, identity: given, today });
      const r = rows.get(id)!;
      if (outcome.status === 'verified') r.status = 'verified';
      if (outcome.status === 'failed')
        Object.assign(r, { status: 'failed', failureCode: outcome.failureCode });
      return outcome;
    },
  };
  return {
    repo,
    rows,
    completed,
    consents,
    setOutcome: (o: CompleteOutcome) => (outcome = o),
  };
}

const profile = (over: Partial<ProfileState> = {}): ProfileState => ({
  category: 'professional',
  isIdentityVerified: false,
  verifiedGender: null,
  deleted: false,
  suspendedUntil: null,
  version: '1',
  ...over,
});

async function setup(
  opts: {
    state?: ProfileState | null;
    versions?: Record<string, string> | null;
    provider?: DigiLockerProvider;
  } = {},
) {
  const mem = memoryRepo();
  const lines: string[] = [];
  const mock = mockDigiLockerProvider({ publicApiUrl: 'http://localhost:8080', now: () => NOW });
  const provider = opts.provider ?? mock;
  const state = 'state' in opts ? opts.state : profile();
  const app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', DIGILOCKER_WEBHOOK_SECRETS: SECRET }),
    jwtVerifier: async (token) => ({ id: token === 'other.t.t' ? OTHER : USER, appRole: 'user' }),
    now: () => NOW,
    digilocker: provider,
    // Only what the verification routes use.
    meRepo: {
      profileState: async () => state ?? null,
      legalVersions: async () =>
        'versions' in opts
          ? opts.versions
          : { terms: 't1', privacy: 'p1', identity_verification: 'iv1' },
    } as never,
    verificationRepo: () => mem.repo,
    logStream: { write: (line) => void lines.push(line) },
  });
  const auth = (token = 'user.t.t') => ({ authorization: `Bearer ${token}` });
  const start = (body: unknown = { consentVersion: 'iv1' }, token?: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/verifications/digilocker',
      headers: auth(token),
      payload: body as object,
    });
  const webhook = (payload: string, key = KEY, timestamp = Math.floor(NOW / 1000)) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/digilocker',
      headers: {
        'content-type': 'application/json',
        'webhook-id': 'msg_1',
        'webhook-timestamp': String(timestamp),
        'webhook-signature': `v1,${signWebhook(key, 'msg_1', timestamp, payload)}`,
      },
      payload,
    });
  return { app, mem, mock, start, webhook, auth, lines };
}

describe('POST /v1/verifications/digilocker', () => {
  it('records the consent and returns the provider page; a new start replaces a pending one', async () => {
    const { app, mem, start } = await setup();
    const res = await start();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.redirectUrl).toMatch(/^http:\/\/localhost:8080\/dev\/digilocker\/mock_/);
    expect(body.expiresAt).toBe(new Date(NOW + 10 * 60_000).toISOString());
    expect(mem.consents).toEqual([{ userId: USER, version: 'iv1' }]);
    const second = (await start()).json();
    expect(mem.rows.get(body.verificationId)!.status).toBe('expired');
    expect(mem.rows.get(second.verificationId)!.status).toBe('pending');
    await app.close();
  });

  it('needs the current identity verification notice', async () => {
    const { app, start } = await setup();
    const res = await start({ consentVersion: 'old' });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0]).toMatchObject({
      path: 'body.consentVersion',
      code: 'outdated_version',
    });
    expect((await start({})).statusCode).toBe(422);
    await app.close();
    const closed = await setup({ versions: { terms: 't1', privacy: 'p1' } });
    expect((await closed.start()).statusCode).toBe(503);
    await closed.app.close();
  });

  it('refuses the verified, the profile-less, deleted and suspended accounts, and the signed out', async () => {
    for (const [state, status, code] of [
      [profile({ isIdentityVerified: true, verifiedGender: 'female' }), 409, 'conflict'],
      [null, 409, 'profile.incomplete'],
      [profile({ deleted: true }), 401, 'auth.account_deleted'],
      [profile({ suspendedUntil: '2026-12-01T00:00:00.000Z' }), 403, 'account.suspended'],
    ] as const) {
      const { app, start } = await setup({ state });
      const res = await start();
      expect(res.statusCode, code).toBe(status);
      expect(res.json().code).toBe(code);
      await app.close();
    }
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verifications/digilocker',
      payload: { consentVersion: 'iv1' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('503 when the provider is down; 5 starts an hour', async () => {
    const down: DigiLockerProvider = {
      name: 'down',
      start: async () => {
        throw new DigiLockerUnavailable('timeout');
      },
      result: async () => null,
    };
    const broken = await setup({ provider: down });
    expect((await broken.start()).statusCode).toBe(503);
    await broken.app.close();
    const { app, start } = await setup();
    for (let i = 0; i < 5; i++) expect((await start()).statusCode).toBe(201);
    expect((await start()).statusCode).toBe(429);
    await app.close();
  });
});

describe('reading verifications', () => {
  it('the owner sees status and failure code; others get 404', async () => {
    const { app, start, auth } = await setup();
    const { verificationId } = (await start()).json();
    const mine = await app.inject({
      method: 'GET',
      url: `/v1/verifications/${verificationId}`,
      headers: auth(),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({
      id: verificationId,
      type: 'digilocker',
      status: 'pending',
      failureCode: null,
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/verifications/${verificationId}`,
          headers: auth('other.t.t'),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/verifications/not-a-uuid', headers: auth() }))
        .statusCode,
    ).toBe(422);
    const list = await app.inject({ method: 'GET', url: '/v1/verifications', headers: auth() });
    expect(list.json().verifications).toHaveLength(1);
    await app.close();
  });
});

describe('POST /webhooks/digilocker', () => {
  it('refuses unsigned, wrongly signed and stale deliveries', async () => {
    const { app, webhook } = await setup();
    const body = JSON.stringify({ providerRef: 'mock_x' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/digilocker',
          headers: { 'content-type': 'application/json' },
          payload: body,
        })
      ).statusCode,
    ).toBe(401);
    expect((await webhook(body, randomBytes(32))).statusCode).toBe(401);
    expect((await webhook(body, KEY, Math.floor(NOW / 1000) - 600)).statusCode).toBe(401);
    expect((await webhook('not json')).statusCode).toBe(400);
    expect((await webhook(JSON.stringify({ nope: 1 }))).statusCode).toBe(400);
    await app.close();
  });

  it('fetches the result from the provider (never from the webhook) and completes', async () => {
    const { app, mem, mock, start, webhook } = await setup();
    const { verificationId, redirectUrl } = (await start()).json();
    const ref = redirectUrl.split('/').pop();
    // Still pending at the provider: nothing happens.
    expect((await webhook(JSON.stringify({ providerRef: ref, name: 'FORGED' }))).statusCode).toBe(
      200,
    );
    expect(mem.completed).toEqual([]);
    mock.complete(ref, { identity });
    expect((await webhook(JSON.stringify({ providerRef: ref, name: 'FORGED' }))).statusCode).toBe(
      200,
    );
    expect(mem.completed).toEqual([{ id: verificationId, identity, today: '2026-11-24' }]);
    // Repeated delivery: the attempt is no longer pending, nothing runs twice.
    expect((await webhook(JSON.stringify({ providerRef: ref }))).statusCode).toBe(200);
    expect(mem.completed).toHaveLength(1);
    await app.close();
  });

  it('a cancelled consent fails as user_cancelled; unknown references are acknowledged', async () => {
    const { app, mem, mock, start, webhook } = await setup();
    const { verificationId, redirectUrl } = (await start()).json();
    const ref = redirectUrl.split('/').pop();
    mock.complete(ref, { cancelled: true });
    expect((await webhook(JSON.stringify({ providerRef: ref }))).statusCode).toBe(200);
    expect(mem.rows.get(verificationId)).toMatchObject({
      status: 'failed',
      failureCode: 'user_cancelled',
    });
    expect((await webhook(JSON.stringify({ providerRef: 'mock_unknown' }))).statusCode).toBe(200);
    await app.close();
  });

  it('503 (the provider retries) when the result cannot be fetched', async () => {
    const mock = mockDigiLockerProvider({ publicApiUrl: 'http://localhost:8080', now: () => NOW });
    const flaky: DigiLockerProvider = {
      name: mock.name,
      start: (o) => mock.start(o),
      result: async () => {
        throw new DigiLockerUnavailable('timeout');
      },
    };
    const { app, start, webhook } = await setup({ provider: flaky });
    const ref = (await start()).json().redirectUrl.split('/').pop();
    expect((await webhook(JSON.stringify({ providerRef: ref }))).statusCode).toBe(503);
    await app.close();
  });
});

describe('the mock consent page (local and test environments only)', () => {
  it('shows the page; approving sends a signed webhook that completes the attempt', async () => {
    const { app, mem, start, lines } = await setup();
    const { verificationId, redirectUrl } = (await start()).json();
    const path = new URL(redirectUrl).pathname;
    const pageRes = await app.inject({ method: 'GET', url: path });
    expect(pageRes.statusCode).toBe(200);
    expect(pageRes.headers['content-type']).toContain('text/html');
    expect(pageRes.body).toContain('DigiLocker (test)');
    const form = new URLSearchParams({
      action: 'approve',
      name: identity.name,
      dateOfBirth: identity.dateOfBirth,
      gender: identity.gender,
      digilockerId: identity.digilockerId,
    }).toString();
    const done = await app.inject({
      method: 'POST',
      url: path,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form,
    });
    expect(done.statusCode).toBe(200);
    expect(mem.completed).toEqual([{ id: verificationId, identity, today: '2026-11-24' }]);
    // The link works once.
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    // Nothing about the identity reaches the logs.
    const log = lines.join('\n');
    for (const secret of [identity.name, identity.dateOfBirth, identity.digilockerId])
      expect(log).not.toContain(secret);
    expect(log).toContain('verification finished');
    await app.close();
  });

  it('a bad form is refused; deny fails the attempt; unknown links are 404', async () => {
    const { app, mem, start } = await setup();
    const { verificationId, redirectUrl } = (await start()).json();
    const path = new URL(redirectUrl).pathname;
    const post = (fields: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: path,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams(fields).toString(),
      });
    expect(
      (await post({ action: 'approve', name: '', dateOfBirth: 'x', gender: 'f' })).statusCode,
    ).toBe(400);
    expect((await post({ action: 'cancel' })).statusCode).toBe(200);
    expect(mem.rows.get(verificationId)!.failureCode).toBe(
      'user_cancelled' satisfies VerificationFailureCode,
    );
    expect((await app.inject({ method: 'GET', url: '/dev/digilocker/mock_nope' })).statusCode).toBe(
      404,
    );
    await app.close();
  });
});

describe('configuration', () => {
  it('production refuses the mock; staging needs the encryption key and webhook secrets', () => {
    const staging = {
      APP_ENV: 'staging',
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      SUPABASE_JWT_ISSUER: 'https://x.supabase.co/auth/v1',
      SUPABASE_JWT_SECRET: randomBytes(32).toString('hex'),
      SEND_SMS_HOOK_SECRETS: SECRET,
      HASH_PEPPER: randomBytes(32).toString('base64'),
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: randomBytes(24).toString('hex'),
    };
    const key = `v1:${randomBytes(32).toString('base64')}`;
    expect(() => loadEnv({ ...staging, DIGILOCKER_WEBHOOK_SECRETS: SECRET })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
    expect(() => loadEnv({ ...staging, FIELD_ENCRYPTION_KEY: key })).toThrow(
      /DIGILOCKER_WEBHOOK_SECRETS/,
    );
    expect(() =>
      loadEnv({ ...staging, FIELD_ENCRYPTION_KEY: key, DIGILOCKER_WEBHOOK_SECRETS: SECRET }),
    ).not.toThrow();
    expect(() => loadEnv({ FIELD_ENCRYPTION_KEY: 'plain' })).toThrow();
    expect(() =>
      loadEnv({
        ...staging,
        APP_ENV: 'production',
        PLACES_PROVIDER: 'google',
        GOOGLE_PLACES_API_KEY: 'test-key',
        CORS_ALLOWED_ORIGINS: 'https://flatrimony.in',
        FIELD_ENCRYPTION_KEY: key,
        DIGILOCKER_WEBHOOK_SECRETS: SECRET,
      }),
    ).toThrow(/DIGILOCKER_PROVIDER=mock/);
  });
});
