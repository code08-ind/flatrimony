import { describe, expect, it } from 'vitest';
import {
  BIODATA_WEIGHTS,
  biodataCompletion,
  BootstrapRequest,
  ConsentGrant,
  MePatch,
  REQUIRED_CONSENTS,
  type BiodataParts,
} from './index.js';

const bootstrap = {
  displayName: 'Karan',
  dateOfBirth: '2002-04-18',
  intent: 'need_room',
  category: 'women_only',
  locale: 'en',
  consents: [
    { purpose: 'terms', version: '2026-11-01' },
    { purpose: 'privacy', version: '2026-11-01' },
  ],
  device: { deviceId: 'install-0f8e2c7a9b', platform: 'android', appVersion: '1.0.0' },
};

describe('BootstrapRequest', () => {
  it('accepts the documented request (docs/05 §8.2)', () => {
    expect(BootstrapRequest.parse(bootstrap).displayName).toBe('Karan');
  });

  it.each([
    ['unknown field', { ...bootstrap, aadhaarNumber: '1234' }],
    [
      'duplicate purpose',
      { ...bootstrap, consents: [bootstrap.consents[0], bootstrap.consents[0]] },
    ],
    ['no consents', { ...bootstrap, consents: [] }],
    ['unknown purpose', { ...bootstrap, consents: [{ purpose: 'aadhaar', version: 'v1' }] }],
    ['bad version', { ...bootstrap, consents: [{ purpose: 'terms', version: 'v 1' }] }],
    ['invisible name', { ...bootstrap, displayName: '\u200b\u200b' }],
    ['bad date', { ...bootstrap, dateOfBirth: '2002-02-30' }],
    ['device extra field', { ...bootstrap, device: { ...bootstrap.device, imei: '1' } }],
    ['app version', { ...bootstrap, device: { ...bootstrap.device, appVersion: 'latest' } }],
    ['push token spaces', { ...bootstrap, device: { ...bootstrap.device, pushToken: 'a b' } }],
  ])('rejects %s', (_name, value) => {
    expect(BootstrapRequest.safeParse(value).success).toBe(false);
  });
});

describe('MePatch', () => {
  it('accepts partial edits and null to clear', () => {
    expect(MePatch.parse({ bio: null, isPaused: true })).toEqual({ bio: null, isPaused: true });
    expect(MePatch.parse({ bio: '  Early riser  ' })).toEqual({ bio: 'Early riser' });
  });

  it.each([
    ['date of birth (DigiLocker replaces it)', { dateOfBirth: '2000-01-01' }],
    ['verified flags', { isIdentityVerified: true }],
    ['bio too long', { bio: 'x'.repeat(301) }],
    ['duplicate languages', { languages: ['hi', 'hi'] }],
    ['name cannot be cleared', { displayName: null }],
  ])('rejects %s', (_name, value) => {
    expect(MePatch.safeParse(value).success).toBe(false);
  });

  it('an empty patch parses; the API answers it with 422 "Nothing to change"', () => {
    expect(MePatch.parse({})).toEqual({});
  });

  it('bio: line breaks yes; NUL, bidi overrides and broken characters no', () => {
    expect(MePatch.safeParse({ bio: 'Line one\nLine two' }).success).toBe(true);
    for (const bio of ['a\u0000b', 'x\u202Ey', 'a\uDC00'])
      expect(MePatch.safeParse({ bio }).success, JSON.stringify(bio)).toBe(false);
  });

  it('counts the bio in characters, not UTF-16 units', () => {
    expect(MePatch.safeParse({ bio: '🙂'.repeat(300) }).success).toBe(true);
  });
});

describe('consents', () => {
  it('Terms and Privacy are the required purposes', () => {
    expect(REQUIRED_CONSENTS).toEqual(['terms', 'privacy']);
    expect(ConsentGrant.safeParse({ purpose: 'terms', version: '2026-11-01' }).success).toBe(true);
  });
});

describe('biodataCompletion', () => {
  const none = Object.fromEntries(
    Object.keys(BIODATA_WEIGHTS).map((k) => [k, false]),
  ) as BiodataParts;

  it('weights sum to 100', () => {
    expect(Object.values(BIODATA_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(
      biodataCompletion(
        Object.fromEntries(Object.keys(none).map((k) => [k, true])) as BiodataParts,
      ),
    ).toBe(100);
    expect(biodataCompletion(none)).toBe(0);
  });

  it('the six onboarding steps give 40 % (FR-AUTH-06 AC)', () => {
    expect(
      biodataCompletion({
        ...none,
        basics: true,
        preferences: true,
        anchorOrAreas: true,
        lifestyle: true,
      }),
    ).toBe(40);
  });
});

describe('photo contracts (T2.10)', () => {
  it('upload-url: JPEG or WebP up to 8 MB', async () => {
    const { PhotoUploadUrlRequest, PHOTO_MAX_BYTES } = await import('./index.js');
    expect(
      PhotoUploadUrlRequest.safeParse({ contentType: 'image/webp', sizeBytes: 1 }).success,
    ).toBe(true);
    expect(
      PhotoUploadUrlRequest.safeParse({ contentType: 'image/jpeg', sizeBytes: PHOTO_MAX_BYTES })
        .success,
    ).toBe(true);
    for (const bad of [
      { contentType: 'image/png', sizeBytes: 1 },
      { contentType: 'image/jpeg', sizeBytes: PHOTO_MAX_BYTES + 1 },
      { contentType: 'image/jpeg', sizeBytes: 1, extra: 1 },
    ])
      expect(PhotoUploadUrlRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('confirm and order', async () => {
    const { PhotoConfirmRequest, PhotoOrderRequest } = await import('./index.js');
    expect(PhotoConfirmRequest.safeParse({ storageKey: 'a/b', position: 5 }).success).toBe(true);
    expect(PhotoConfirmRequest.safeParse({ storageKey: 'a/b', position: 6 }).success).toBe(false);
    const id = '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
    const id2 = '3b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
    expect(PhotoOrderRequest.safeParse({ photoIds: [id, id2] }).success).toBe(true);
    expect(PhotoOrderRequest.safeParse({ photoIds: [id, id] }).success).toBe(false);
    expect(PhotoOrderRequest.safeParse({ photoIds: [] }).success).toBe(false);
  });
});
