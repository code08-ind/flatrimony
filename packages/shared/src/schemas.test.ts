import { describe, expect, it } from 'vitest';
import {
  Anchor,
  ERROR_CATALOGUE,
  ERROR_CODES,
  EMERGENCY_NUMBER,
  IndianPhone,
  LIMITS,
  Lifestyle,
  CreateListingRequest,
  ListingCosts,
  ListingPatch,
  mentionsBrokerage,
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
import { humanText, LanguageCode } from './primitives.js';

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

describe('human text (mirrors public.is_human_text)', () => {
  const name = humanText(40);

  it('trims and accepts real names, including Hindi', () => {
    expect(name.parse('  Karan  ')).toBe('Karan');
    expect(name.safeParse('K').success).toBe(true);
    expect(name.safeParse('क'.repeat(40)).success).toBe(true);
    expect(name.safeParse('मीरा').success).toBe(true);
  });

  it('counts code points like Postgres, not UTF-16 units', () => {
    expect(name.safeParse('😀'.repeat(40)).success).toBe(true);
    expect(name.safeParse('😀'.repeat(41)).success).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['zero-width only', '\u200B'],
    ['bidi override', 'Admin\u202E'],
    ['control character', 'Ka\u0007ran'],
    ['Hangul filler (renders blank)', '\u3164'],
    ['Braille blank', 'A\u2800'],
    ['halfwidth Hangul filler', '\uFFA0'],
    ['lone surrogate', 'a\uD800b'],
    ['41 characters', 'x'.repeat(41)],
  ])('rejects %s', (_label, value) => {
    expect(name.safeParse(value).success).toBe(false);
  });

  it('accepts ISO 639-1 language codes only', () => {
    expect(LanguageCode.safeParse('hi').success).toBe(true);
    expect(LanguageCode.safeParse('HI').success).toBe(false);
    expect(LanguageCode.safeParse('klingon').success).toBe(false);
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

  it('enforces the database limits on budget and lease (docs/04 §6.2)', () => {
    expect(Preferences.safeParse({ ...preferences, budgetMinInr: 999 }).success).toBe(false);
    expect(Preferences.safeParse({ ...preferences, budgetMaxInr: 200_001 }).success).toBe(false);
    expect(
      Preferences.safeParse({ ...preferences, budgetMinInr: 1000, budgetMaxInr: 200_000 }).success,
    ).toBe(true);
    expect(Preferences.safeParse({ ...preferences, leaseMonths: 0 }).success).toBe(false);
    expect(Preferences.safeParse({ ...preferences, leaseMonths: 37 }).success).toBe(false);
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
    expect(Me.safeParse({ ...me, displayName: 'x'.repeat(41) }).success).toBe(false);
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

  it('one-time costs never name a broker (FR-LST-03)', () => {
    expect(ListingCosts.safeParse(costs).success).toBe(true);
    // The API refuses these labels with listing.brokerage_not_allowed.
    for (const label of ['Brokerage', 'Broker fee', 'दलाली', 'Agent fee', 'Commission'])
      expect(mentionsBrokerage(label), label).toBe(true);
    expect(mentionsBrokerage('Setup')).toBe(false);
    // Look-alikes fold to the word (QA T3.5): digits, Cyrillic, full-width, spacing, Hindi, typos.
    for (const label of [
      'Br0kerage',
      'Brоkerage',
      'Ｂｒｏｋｅｒａｇｅ',
      'B r o k e r a g e',
      'Commision',
      'Agency fee',
      'ब्रोकरेज',
      'कमीशन',
    ])
      expect(mentionsBrokerage(label), label).toBe(true);
    for (const label of ['Setup', 'Society move-in fee', 'Cleaning', 'Gas connection'])
      expect(mentionsBrokerage(label), label).toBe(false);
    // Brokerage is not even an input field.
    expect(ListingCosts.safeParse({ ...costs, brokerageInr: 0 }).success).toBe(false);
    expect(ListingCosts.safeParse({ ...costs, wifiInr: 100_001 }).success).toBe(false);
  });

  it("the costs are each person's share: true monthly = rent + their sum", () => {
    expect(trueMonthlyPerPersonInr(15000, costs)).toBe(15000 + 6000);
  });

  const draft = {
    title: 'Sunny room near Cyber Hub',
    areaId: 3,
    location: { lat: 28.4951, lng: 77.0889 },
    bhk: 3,
    roomType: 'private',
    furnishing: 'semi_furnished',
    availableFrom: '2026-12-01',
    totalFlatmates: 3,
    currentFlatmates: 2,
    rentPerPersonInr: 18000,
    depositPerPersonInr: 36000,
  };

  it('a new listing: defaults, NCR only, room left in the flat (FR-LST-02)', () => {
    const ok = CreateListingRequest.parse(draft);
    expect(ok.minLeaseMonths).toBe(11);
    expect(ok.offersVideoTour).toBe(false);
    expect(
      CreateListingRequest.safeParse({ ...draft, location: { lat: 12.97, lng: 77.59 } }).success,
    ).toBe(false); // Bengaluru
    expect(CreateListingRequest.safeParse({ ...draft, currentFlatmates: 3 }).success).toBe(false);
    expect(CreateListingRequest.safeParse({ ...draft, title: 'Room' }).success).toBe(false);
    expect(CreateListingRequest.safeParse({ ...draft, ownerId: id }).success).toBe(false);
    expect(
      CreateListingRequest.safeParse({ ...draft, description: 'Line one\nline two' }).success,
    ).toBe(true);
    const zeroWidth = String.fromCodePoint(0x200b);
    expect(CreateListingRequest.safeParse({ ...draft, description: zeroWidth }).success).toBe(
      false,
    );
  });

  it('a patch changes something, and keeps the flatmates consistent when it names both', () => {
    expect(ListingPatch.safeParse({}).success).toBe(false);
    expect(ListingPatch.safeParse({ description: null }).success).toBe(true);
    expect(ListingPatch.safeParse({ totalFlatmates: 2, currentFlatmates: 2 }).success).toBe(false);
    expect(ListingPatch.safeParse({ status: 'active' }).success).toBe(false);
  });
});

describe('system contracts', () => {
  it('public config and reference data', () => {
    expect(
      PublicConfig.parse({
        dailyLikeLimit: 50,
        features: { videoTours: false, houseAgreement: false },
        minSupportedAppVersion: '1.0.0',
        legalVersions: { terms: '2026-11-01', privacy: '2026-11-01' },
      }),
    ).toBeTruthy();
    expect(
      PublicConfig.safeParse({
        dailyLikeLimit: 50,
        features: { videoTours: false, houseAgreement: false },
        minSupportedAppVersion: 'v1',
        legalVersions: {},
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
