import { describe, expect, it } from 'vitest';
import {
  Anchor,
  ERROR_CATALOGUE,
  ERROR_CODES,
  EMERGENCY_NUMBER,
  IndianPhone,
  LIMITS,
  Lifestyle,
  ListingCosts,
  Me,
  OtpGuardRequest,
  Preferences,
  ProblemDetails,
  PublicConfig,
  PublicProfile,
  ReferenceData,
  RishtaReport,
  TimeOfDay,
  ageOn,
  cursorQuery,
  decodeCursor,
  encodeCursor,
  paged,
  problem,
  statusFor,
  trueMonthlyPerPersonInr,
  Uuid,
} from './index.js';
import { z } from 'zod';

const id = '7d4f3a2e-5b6c-4d7e-8f90-1a2b3c4d5e6f';

const lifestyle = {
  bedtime: '23:00',
  wakeTime: '07:00',
  cleaning: 'daily',
  smoking: 'no',
  pets: 'love',
  food: 'veg',
} as const;

const preferences = {
  budgetMinInr: 15000,
  budgetMaxInr: 20000,
  moveInFrom: '2026-12-01',
  moveInTo: '2026-12-31',
  leaseMonths: 11,
  flatmateGenderPref: 'any',
  areaIds: [1, 2],
} as const;

const passport = {
  identityVerified: true,
  memberSince: '2026-11-15',
  badges: [{ type: 'identity_verified' }],
  habitConfirmations: [],
  pastStays: 0,
  hasReferences: false,
};

describe('error catalogue (docs/05 §13)', () => {
  it('maps every code to an HTTP error status', () => {
    for (const code of ERROR_CODES) {
      expect(statusFor(code)).toBeGreaterThanOrEqual(400);
      expect(statusFor(code)).toBeLessThan(600);
    }
    expect(ERROR_CATALOGUE['verification.required']).toBe(403);
    expect(ERROR_CATALOGUE['swipe.daily_limit_reached']).toBe(403);
    expect(ERROR_CATALOGUE['message.new_conversation_limit']).toBe(429);
  });

  it('builds RFC 9457 problem details', () => {
    const p = problem('verification.required', {
      title: 'Verification required',
      detail: 'Verify your identity with DigiLocker to start chatting.',
      requestId: 'req_1',
    });
    expect(ProblemDetails.parse(p)).toEqual({
      type: 'https://docs.flatrimony.in/errors/verification.required',
      title: 'Verification required',
      status: 403,
      code: 'verification.required',
      detail: 'Verify your identity with DigiLocker to start chatting.',
      requestId: 'req_1',
    });
    expect(problem('not_found').title).toBe('not_found');
  });
});

describe('primitives', () => {
  it('accepts only Indian mobile numbers in E.164', () => {
    expect(IndianPhone.safeParse('+919812345678').success).toBe(true);
    expect(IndianPhone.safeParse('9812345678').success).toBe(false);
    expect(IndianPhone.safeParse('+915812345678').success).toBe(false);
    expect(IndianPhone.safeParse('+14155550100').success).toBe(false);
  });

  it('validates HH:mm and UUIDs', () => {
    expect(TimeOfDay.safeParse('23:59').success).toBe(true);
    expect(TimeOfDay.safeParse('24:00').success).toBe(false);
    expect(TimeOfDay.safeParse('7:00').success).toBe(false);
    expect(Uuid.safeParse(id).success).toBe(true);
    expect(Uuid.safeParse('1').success).toBe(false);
  });

  it('round-trips opaque cursors and rejects garbage', () => {
    const c = encodeCursor('2026-11-12T08:30:00Z', id);
    expect(c).not.toMatch(/[+/=]/);
    expect(decodeCursor(c)).toEqual({ sortKey: '2026-11-12T08:30:00Z', id });
    expect(decodeCursor(encodeCursor(42, 'हिंदी'))).toEqual({ sortKey: 42, id: 'हिंदी' });
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });

  it('applies pagination defaults and bounds', () => {
    expect(cursorQuery().parse({})).toEqual({ limit: 20 });
    expect(cursorQuery().parse({ limit: '50' }).limit).toBe(50);
    expect(cursorQuery().safeParse({ limit: '51' }).success).toBe(false);
    expect(cursorQuery(LIMITS.page.messagesMaxLimit).parse({ limit: '100' }).limit).toBe(100);
    expect(paged(z.string()).parse({ data: ['a'], page: { hasMore: false } }).data).toEqual(['a']);
  });
});

describe('Flat Biodata schemas', () => {
  it('accepts a valid quick biodata', () => {
    expect(Preferences.parse(preferences)).toEqual(preferences);
    expect(Lifestyle.parse(lifestyle)).toEqual(lifestyle);
  });

  it('rejects inverted budgets and move-in windows, too many or duplicate areas', () => {
    expect(Preferences.safeParse({ ...preferences, budgetMinInr: 25000 }).success).toBe(false);
    expect(Preferences.safeParse({ ...preferences, moveInTo: '2026-11-30' }).success).toBe(false);
    expect(Preferences.safeParse({ ...preferences, areaIds: [1, 2, 3, 4] }).success).toBe(false);
    expect(Preferences.safeParse({ ...preferences, areaIds: [1, 1] }).success).toBe(false);
  });

  it('anchors default to a 45-minute commute within 15–90', () => {
    const base = {
      kind: 'office',
      label: 'Cyber City',
      location: { lat: 28.495, lng: 77.089 },
      travelMode: 'metro_transit',
    };
    expect(Anchor.parse(base).maxCommuteMin).toBe(45);
    expect(Anchor.safeParse({ ...base, maxCommuteMin: 10 }).success).toBe(false);
    expect(Anchor.safeParse({ ...base, maxCommuteMin: 91 }).success).toBe(false);
  });

  it('rejects unknown lifestyle enum values', () => {
    expect(Lifestyle.safeParse({ ...lifestyle, cleaning: 'never' }).success).toBe(false);
  });

  it('validates Me with under-18 ages rejected', () => {
    const me = {
      id,
      displayName: 'Karan',
      age: 24,
      intent: 'need_room',
      category: 'professional',
      languages: ['en', 'hi'],
      locale: 'hi',
      isIdentityVerified: false,
      badges: [],
      isPaused: false,
      biodataCompletion: 40,
      photos: [],
      importance: { cleaning: 'dealbreaker' },
      entitlements: { movePass: { active: false } },
      createdAt: '2026-11-15T06:00:00Z',
    };
    expect(Me.parse(me).displayName).toBe('Karan');
    expect(Me.safeParse({ ...me, age: 17 }).success).toBe(false);
    expect(Me.safeParse({ ...me, importance: { cleaning: 'very' } }).success).toBe(false);
    expect(Me.safeParse({ ...me, bio: 'x'.repeat(301) }).success).toBe(false);
  });

  it('PublicProfile never carries private fields', () => {
    const pub = {
      id,
      displayName: 'Meera',
      age: 28,
      category: 'women_only',
      intent: 'have_room',
      languages: ['en'],
      badges: [{ type: 'female_verified' }],
      photos: [{ id, url: 'https://cdn.example/p.webp' }],
      lifestyle,
      budget: { minInr: 15000, maxInr: 22000 },
      moveInFrom: '2026-12-01',
      passport,
    };
    expect(PublicProfile.parse(pub).displayName).toBe('Meera');
    for (const leak of [
      'phone',
      'dob',
      'verifiedName',
      'exactLocation',
      'address',
      'digilockerIdHash',
    ]) {
      expect(PublicProfile.safeParse({ ...pub, [leak]: 'x' }).success, leak).toBe(false);
    }
  });

  it('computes age from DOB on a given day', () => {
    expect(ageOn('2002-11-15', '2026-11-15')).toBe(24);
    expect(ageOn('2002-11-16', '2026-11-15')).toBe(23);
    expect(ageOn('2002-12-01', '2026-11-15')).toBe(23);
  });
});

describe('listings', () => {
  const costs = {
    maintenanceInr: 1500,
    electricityEstimateInr: 1200,
    wifiInr: 900,
    helpInr: 2400,
    otherRecurringInr: 0,
    oneTimeCosts: [{ label: 'Setup', amountInr: 2000 }],
  };

  it('allows zero brokerage only (FR-LST-03)', () => {
    expect(ListingCosts.safeParse(costs).success).toBe(true);
    expect(
      ListingCosts.safeParse({ ...costs, oneTimeCosts: [{ label: 'Brokerage', amountInr: 0 }] })
        .success,
    ).toBe(true);
    const bad = ListingCosts.safeParse({
      ...costs,
      oneTimeCosts: [{ label: 'Broker fee', amountInr: 5000 }],
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['oneTimeCosts', 0, 'amountInr']);
    expect(
      ListingCosts.safeParse({ ...costs, oneTimeCosts: [{ label: 'दलाली', amountInr: 1 }] })
        .success,
    ).toBe(false);
  });

  it('computes the all-in monthly cost per person', () => {
    expect(trueMonthlyPerPersonInr(15000, costs, 3)).toBe(15000 + 2000);
    expect(trueMonthlyPerPersonInr(15000, { ...costs, wifiInr: 901 }, 3)).toBe(17001);
    expect(() => trueMonthlyPerPersonInr(15000, costs, 0)).toThrow(RangeError);
  });
});

describe('system contracts', () => {
  it('public config and reference data', () => {
    expect(
      PublicConfig.parse({
        dailyLikeLimit: 50,
        features: { videoTours: false, houseAgreement: false },
        minSupportedAppVersion: '1.0.0',
      }),
    ).toBeTruthy();
    expect(
      PublicConfig.safeParse({
        dailyLikeLimit: 50,
        features: { videoTours: false, houseAgreement: false },
        minSupportedAppVersion: 'v1',
      }).success,
    ).toBe(false);
    expect(
      ReferenceData.parse({
        areas: [
          {
            id: 1,
            slug: 'gurugram-cyber-city',
            name: 'Cyber City',
            city: 'gurugram',
            centroid: { lat: 28.495, lng: 77.089 },
          },
        ],
        habitTags: [{ id: 'tidy', label: 'Tidy', attribute: 'cleaning' }],
        scenarioQuestions: [
          {
            id: 'sink_dishes_10pm',
            attribute: 'cleaning',
            prompt: 'x',
            options: [
              { id: 'a', label: 'A', value: 1 },
              { id: 'b', label: 'B', value: 0 },
            ],
          },
        ],
        products: [],
      }).areas,
    ).toHaveLength(1);
  });

  it('OTP guard accepts Indian numbers only', () => {
    expect(
      OtpGuardRequest.safeParse({ phone: '+919812345678', deviceId: 'b7c1d2e3f4' }).success,
    ).toBe(true);
    expect(OtpGuardRequest.safeParse({ phone: '+919812345678', deviceId: 'x' }).success).toBe(
      false,
    );
  });

  it('Rishta report bounds', () => {
    expect(
      RishtaReport.safeParse({ score: 94, agreements: [], perAttribute: { bedtime: 1 } }).success,
    ).toBe(true);
    expect(RishtaReport.safeParse({ score: 101, agreements: [], perAttribute: {} }).success).toBe(
      false,
    );
  });

  it('112 is the emergency number', () => {
    expect(EMERGENCY_NUMBER).toBe('112');
  });
});
