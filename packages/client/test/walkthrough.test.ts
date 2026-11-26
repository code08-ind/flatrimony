import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { messages } from '@flatrimony/i18n';
import { walkthroughRequestHashInput } from '@flatrimony/shared';
import {
  canStopRecording,
  failure,
  mockIntegrityToken,
  recordingClock,
  submitWalkthrough,
  takeIsUsable,
  walkthroughUploadsAvailable,
  type WalkthroughDeps,
  type WalkthroughTake,
} from '../src/index.js';

const LISTING = '7d4f3a2e-5b6c-4d7e-8f90-1a2b3c4d5e6f';
const KEY = `uploads/${LISTING}/0b1c2d3e-4f50-4617-8899-aabbccddeeff.mp4`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const take: WalkthroughTake = {
  uri: 'file:///cache/walk.mp4',
  sizeBytes: 12_000_000,
  durationS: 44.6,
  capturedAt: '2026-11-27T10:00:00.000Z',
};
const listing = {
  id: LISTING,
  status: 'draft',
  title: 'Sunny room',
  description: null,
  areaId: 1,
  location: { lat: 28.5, lng: 77.1 },
  approxLocation: { lat: 28.5, lng: 77.1 },
  address: null,
  bhk: 3,
  roomType: 'private',
  furnishing: 'furnished',
  availableFrom: '2026-12-15',
  minLeaseMonths: 11,
  totalFlatmates: 3,
  currentFlatmates: 2,
  rentPerPersonInr: 18000,
  depositPerPersonInr: 36000,
  offersVideoTour: false,
  rules: null,
  costs: null,
  trueMonthlyPerPersonInr: null,
  media: [],
  missing: ['rules', 'costs', 'photos'],
  lastConfirmedAt: null,
  expiresAt: null,
  publishedAt: null,
  createdAt: '2026-11-27T09:00:00.000Z',
  updatedAt: '2026-11-27T10:01:00.000Z',
};

function fakes(over: Partial<WalkthroughDeps> = {}) {
  const calls: { path: string; body: unknown }[] = [];
  const deps: WalkthroughDeps = {
    async post(path, body) {
      calls.push({ path, body });
      if (path.endsWith('/upload-url'))
        return {
          status: 200,
          body: { uploadUrl: 'https://r2.test/put', storageKey: KEY, expiresAt: take.capturedAt },
        };
      return { status: 201, body: listing };
    },
    put: async () => ({ status: 200 }),
    fileSha256: async () => sha('the video'),
    textSha256: async (t) => sha(t),
    integrityToken: async (h) => `token-for-${h}`,
    ...over,
  };
  return { deps, calls };
}

describe('recording rules (FR-LST-05)', () => {
  it('stop works a second after 30 s; a take is judged by its file, in whole seconds', () => {
    expect(canStopRecording(30)).toBe(false);
    expect(canStopRecording(31)).toBe(true);
    const ok = { sizeBytes: 1000 };
    expect(takeIsUsable({ ...ok, durationS: 29.4 })).toBe(false); // the API rounds to 29
    expect(takeIsUsable({ ...ok, durationS: 29.6 })).toBe(true);
    expect(takeIsUsable({ ...ok, durationS: 90.4 })).toBe(true);
    expect(takeIsUsable({ ...ok, durationS: 90.6 })).toBe(false);
    expect(takeIsUsable({ sizeBytes: 26 * 1024 * 1024, durationS: 60 })).toBe(false);
    expect(takeIsUsable({ sizeBytes: 0, durationS: 60 })).toBe(false);
    expect(recordingClock(0)).toBe('0:00');
    expect(recordingClock(65.7)).toBe('1:05');
  });

  it('a production build needs the Play Integrity project; local and staging use mock tokens', () => {
    expect(walkthroughUploadsAvailable('production', '')).toBe(false);
    expect(walkthroughUploadsAvailable('production', '1234567890')).toBe(true);
    expect(walkthroughUploadsAvailable('staging', '')).toBe(true);
    expect(walkthroughUploadsAvailable('local', '')).toBe(true);
  });
});

describe('submitting a take', () => {
  it('asks for an upload URL, PUTs the file, binds the integrity token to this upload, confirms', async () => {
    const { deps, calls } = fakes();
    const result = await submitWalkthrough(LISTING, take, deps);
    expect(result).toMatchObject({ ok: true, listing: { id: LISTING } });
    expect(calls[0]).toEqual({
      path: `/listings/${LISTING}/media/upload-url`,
      body: { kind: 'walkthrough_video', contentType: 'video/mp4', sizeBytes: 12_000_000 },
    });
    const requestHash = sha(walkthroughRequestHashInput(KEY, sha('the video')));
    expect(calls[1]).toEqual({
      path: `/listings/${LISTING}/media`,
      body: {
        kind: 'walkthrough_video',
        storageKey: KEY,
        sha256: sha('the video'),
        durationS: 45,
        capturedAt: take.capturedAt,
        recordedInApp: true,
        integrityToken: `token-for-${requestHash}`,
      },
    });
  });

  it("sends the file's own length, rounded, not clamped", async () => {
    const { deps, calls } = fakes();
    await submitWalkthrough(LISTING, { ...take, durationS: 90.4 }, deps);
    expect((calls[1]!.body as { durationS: number }).durationS).toBe(90);
  });

  it('a take over 25 MB is refused before any upload', async () => {
    const { deps, calls } = fakes();
    expect(
      await submitWalkthrough(LISTING, { ...take, sizeBytes: 26 * 1024 * 1024 }, deps),
    ).toEqual({ ok: false, error: 'listing.video.errors.tooLarge', next: 'record' });
    expect(calls).toEqual([]);
  });

  it('Google Play not answering is a retry of the same take, not a network or integrity error', async () => {
    const { deps } = fakes({
      integrityToken: async () => {
        throw new Error('INTEGRITY_TOKEN_PROVIDER_INVALID');
      },
    });
    expect(await submitWalkthrough(LISTING, take, deps)).toEqual({
      ok: false,
      error: 'listing.video.errors.unavailable',
      next: 'retry',
    });
  });

  it('a failed PUT or a lost connection is a retry with the same take', async () => {
    expect(
      await submitWalkthrough(LISTING, take, fakes({ put: async () => ({ status: 403 }) }).deps),
    ).toEqual({ ok: false, error: 'listing.video.errors.upload', next: 'retry' });
    expect(
      await submitWalkthrough(
        LISTING,
        take,
        fakes({
          put: async () => {
            throw new Error('offline');
          },
        }).deps,
      ),
    ).toEqual({ ok: false, error: 'listing.video.errors.network', next: 'retry' });
  });

  it("the API's reasons become messages; a take the API refuses is recorded again", () => {
    const invalid = (code: string) => ({
      code: 'listing.video_invalid',
      errors: [{ path: 'body', code, message: 'x' }],
    });
    expect(failure(422, invalid('old'))).toMatchObject({
      error: 'listing.video.errors.old',
      next: 'record',
    });
    expect(failure(422, invalid('duration')).error).toBe('listing.video.errors.duration');
    expect(failure(422, invalid('too_large')).error).toBe('listing.video.errors.tooLarge');
    expect(failure(422, invalid('hash_mismatch'))).toMatchObject({ next: 'retry' });
    expect(failure(422, invalid('not_mp4')).error).toBe('listing.video.errors.invalid');
    expect(failure(403, { code: 'integrity.failed' })).toMatchObject({
      error: 'listing.video.errors.integrity',
      next: 'stop',
    });
    expect(failure(422, { code: 'validation.failed' })).toMatchObject({ next: 'record' });
    expect(failure(404, {})).toMatchObject({
      error: 'listing.video.errors.notFound',
      next: 'stop',
    });
    expect(failure(409, { code: 'conflict' })).toMatchObject({
      error: 'listing.video.errors.notEditable',
      next: 'stop',
    });
    expect(failure(429, {}).next).toBe('retry');
    expect(failure(503, {}).error).toBe('listing.video.errors.unavailable');
    expect(failure(500, null).error).toBe('listing.video.errors.generic');
  });

  it('every message exists in English and Hindi', () => {
    const keys = [
      'upload',
      'network',
      'old',
      'duration',
      'tooLarge',
      'invalid',
      'integrity',
      'notFound',
      'notEditable',
      'tooMany',
      'unavailable',
      'generic',
      'camera',
    ];
    for (const locale of ['en', 'hi'] as const)
      for (const k of keys)
        expect(typeof messages[locale].listing.video.errors[k as 'upload'], `${locale}:${k}`).toBe(
          'string',
        );
  });
});

describe('mock integrity tokens (local and staging builds)', () => {
  it("have the shape the API's mock verifier reads", () => {
    const token = mockIntegrityToken('ab'.repeat(32), Date.parse('2026-11-27T10:00:00Z'));
    expect(token.startsWith('mock.')).toBe(true);
    const claims = JSON.parse(Buffer.from(token.slice(5), 'base64url').toString('utf8'));
    expect(claims).toEqual({
      verdict: 'meets_device_integrity',
      requestHash: 'ab'.repeat(32),
      issuedAt: Math.floor(Date.parse('2026-11-27T10:00:00Z') / 1000),
    });
  });
});
