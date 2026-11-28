import { describe, expect, it } from 'vitest';
import type { Lifestyle, LifestyleAttribute } from '@flatrimony/shared';
import {
  ATTRIBUTES,
  CLEANING_SCALE,
  FOOD,
  FREQUENCY_SCALE,
  PETS,
  RANK_BOOST,
  SMOKING_SCALE,
  WORK_MODE,
  attributeSimilarity,
  blendedSimilarity,
  canSee,
  clockDistance,
  compatibility,
  dealbreakerConflicts,
  importanceOf,
  isVerifiedWoman,
  lifestyleValue,
  minutesOf,
  rankCandidates,
  rankScore,
  rishtaFacts,
  scaleSimilarity,
  scenarioValue,
  timeSimilarity,
  visibleTo,
  weightFor,
  type MatchProfile,
} from './index.js';

const base: Lifestyle = {
  bedtime: '23:00',
  wakeTime: '07:00',
  cleaning: 'daily',
  smoking: 'no',
  pets: 'love',
  food: 'veg',
  cooksAtHome: true,
  drinking: 'rarely',
  guests: 'sometimes',
  parties: 'rarely',
  workMode: 'hybrid',
};
const person = (over: Partial<Lifestyle> = {}, rest: Partial<MatchProfile> = {}): MatchProfile => ({
  lifestyle: { ...base, ...over },
  importance: {},
  ...rest,
});

describe('times of day', () => {
  it('reads minutes and measures across midnight', () => {
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('23:59')).toBe(1439);
    expect(clockDistance('23:30', '00:15')).toBe(45);
    expect(clockDistance('07:00', '07:00')).toBe(0);
    expect(clockDistance('12:00', '00:00')).toBe(720);
  });

  it.each([
    ['23:00', '23:30', 1], // within 30 minutes (spec §5.1)
    ['23:00', '23:31', 0.5],
    ['23:00', '00:30', 0.5], // within 90 minutes, across midnight
    ['23:00', '00:31', 0],
    ['22:00', '02:00', 0],
  ])('%s vs %s → %s', (a, b, s) => {
    expect(timeSimilarity(a, b)).toBe(s);
  });
});

describe('ordered scales', () => {
  it('scores by distance: the same step 1, the far ends 0 (spec §5.1 cleaning)', () => {
    expect(scaleSimilarity(CLEANING_SCALE, 'daily', 'daily')).toBe(1);
    expect(scaleSimilarity(CLEANING_SCALE, 'daily', 'few_times_week')).toBeCloseTo(2 / 3);
    expect(scaleSimilarity(CLEANING_SCALE, 'weekly', 'daily')).toBeCloseTo(1 / 3);
    expect(scaleSimilarity(CLEANING_SCALE, 'daily', 'rarely')).toBe(0);
    expect(scaleSimilarity(SMOKING_SCALE, 'no', 'outside_only')).toBe(0.5);
    expect(scaleSimilarity(FREQUENCY_SCALE, 'never', 'often')).toBe(0);
  });
});

describe('unordered tables', () => {
  it('are symmetric, 1 on the diagonal and within 0..1', () => {
    const check = <T extends string>(values: readonly T[], f: (a: T, b: T) => number) => {
      for (const a of values)
        for (const b of values) {
          expect(f(a, b)).toBe(f(b, a));
          expect(f(a, b)).toBeGreaterThanOrEqual(0);
          expect(f(a, b)).toBeLessThanOrEqual(1);
          if (a === b) expect(f(a, b)).toBe(1);
          else expect(f(a, b)).toBeLessThanOrEqual(1);
        }
    };
    check(['have', 'love', 'ok', 'no'] as const, PETS);
    check(['veg', 'eggetarian', 'non_veg', 'vegan'] as const, FOOD);
    check(['office', 'hybrid', 'wfh', 'night_shift', 'student'] as const, WORK_MODE);
  });

  it('puts the clashes at the bottom', () => {
    expect(PETS('have', 'no')).toBe(0);
    expect(PETS('have', 'love')).toBe(1);
    expect(FOOD('vegan', 'non_veg')).toBe(0);
    expect(FOOD('veg', 'non_veg')).toBe(0.33);
    expect(WORK_MODE('night_shift', 'office')).toBe(0.25);
  });
});

describe('attributeSimilarity', () => {
  const a = base;
  it('compares every attribute when both have it', () => {
    const b: Lifestyle = {
      ...base,
      bedtime: '00:15',
      wakeTime: '08:45',
      cleaning: 'rarely',
      smoking: 'yes',
      pets: 'no',
      food: 'non_veg',
      cooksAtHome: false,
      drinking: 'often',
      guests: 'never',
      parties: 'often',
      workMode: 'night_shift',
    };
    const got = Object.fromEntries(ATTRIBUTES.map((x) => [x, attributeSimilarity(x, a, b)]));
    expect(got).toEqual({
      bedtime: 0.5,
      wake_time: 0,
      cleaning: 0,
      smoking: 0,
      pets: 0.33,
      food: 0.33,
      cooks_at_home: 0.5,
      drinking: expect.closeTo(1 / 3),
      guests: expect.closeTo(1 / 3),
      parties: expect.closeTo(1 / 3),
      work_mode: 0.25,
    });
    expect(attributeSimilarity('cooks_at_home', a, a)).toBe(1);
  });

  it.each(['cooks_at_home', 'drinking', 'guests', 'parties', 'work_mode'] as const)(
    'an empty optional %s is not compared',
    (attribute) => {
      const key = {
        cooks_at_home: 'cooksAtHome',
        drinking: 'drinking',
        guests: 'guests',
        parties: 'parties',
        work_mode: 'workMode',
      }[attribute] as keyof Lifestyle;
      const empty = { ...base };
      delete empty[key];
      expect(attributeSimilarity(attribute, empty, base)).toBeNull();
      expect(attributeSimilarity(attribute, base, empty)).toBeNull();
    },
  );
});

describe('weights (spec §5.1 step 3)', () => {
  it('a missing importance is "matters"; the higher weight wins', () => {
    const a = person({}, { importance: { pets: 'dont_care', food: 'dont_care' } });
    const b = person({}, { importance: { food: 'dont_care', smoking: 'dealbreaker' } });
    expect(importanceOf(a, 'bedtime')).toBe('matters');
    expect(weightFor(a, b, 'pets')).toBe(2); // don't care vs (missing =) matters
    expect(weightFor(a, b, 'food')).toBe(0.5); // both don't care
    expect(weightFor(a, b, 'smoking')).toBe(2); // a deal-breaker weighs as matters
  });
});

describe('scenario answers (FR-DISC-03)', () => {
  it('a member answers an attribute by the mean of its questions', () => {
    const p = person(
      {},
      {
        scenarios: [
          { attribute: 'cleaning', value: 1 },
          { attribute: 'cleaning', value: 0.5 },
          { attribute: 'guests', value: 0 },
        ],
      },
    );
    expect(scenarioValue(p, 'cleaning')).toBe(0.75);
    expect(scenarioValue(p, 'pets')).toBeNull();
    expect(scenarioValue(person(), 'cleaning')).toBeNull();
  });

  it('blends 50/50 with the self-ratings only when both answered', () => {
    const a = person({ cleaning: 'daily' }, { scenarios: [{ attribute: 'cleaning', value: 1 }] });
    const b = person({ cleaning: 'daily' }, { scenarios: [{ attribute: 'cleaning', value: 0 }] });
    expect(blendedSimilarity(a, b, 'cleaning')).toBe(0.5); // self 1, scenarios 0
    expect(blendedSimilarity(a, person(), 'cleaning')).toBe(1); // b answered none: self only
    const noDrink = person(
      { drinking: undefined },
      { scenarios: [{ attribute: 'drinking', value: 1 }] },
    );
    expect(blendedSimilarity(noDrink, a, 'drinking')).toBeNull();
  });
});

describe('compatibility (spec §5.1 step 4)', () => {
  it('identical habits score 100, and the score is symmetric', () => {
    expect(compatibility(person(), person()).score).toBe(100);
    const a = person({ bedtime: '01:00', pets: 'have' }, { importance: { pets: 'dont_care' } });
    const b = person(
      { cleaning: 'weekly', food: 'non_veg' },
      { importance: { food: 'dont_care' } },
    );
    expect(compatibility(a, b).score).toBe(compatibility(b, a).score);
  });

  it('is the weighted average × 100, rounded', () => {
    // Only the five required attributes plus bedtime/wake: drop the optional ones.
    const only = (over: Partial<Lifestyle>): Lifestyle => ({
      bedtime: '23:00',
      wakeTime: '07:00',
      cleaning: 'daily',
      smoking: 'no',
      pets: 'love',
      food: 'veg',
      ...over,
    });
    const a: MatchProfile = { lifestyle: only({}), importance: { cleaning: 'dont_care' } };
    const b: MatchProfile = { lifestyle: only({ cleaning: 'rarely' }), importance: {} };
    // cleaning: weight max(0.5, 2) = 2, similarity 0; the other 5 attributes: weight 2, similarity 1.
    const result = compatibility(a, b);
    expect(result.score).toBe(Math.round((100 * 10) / 12));
    expect(result.attributes.map((m) => m.attribute)).toEqual([
      'bedtime',
      'wake_time',
      'cleaning',
      'smoking',
      'pets',
      'food',
    ]);
    // Both "don't care" about cleaning: it weighs 0.5.
    const c = { ...b, importance: { cleaning: 'dont_care' as const } };
    expect(compatibility(a, c).score).toBe(Math.round((100 * 10) / 10.5));
  });

  it('opposite habits on everything score 0', () => {
    const a = person();
    const b = person({
      bedtime: '05:00',
      wakeTime: '15:00',
      cleaning: 'rarely',
      smoking: 'yes',
      pets: 'no',
      food: 'non_veg',
      cooksAtHome: undefined,
      drinking: undefined,
      guests: undefined,
      parties: undefined,
      workMode: undefined,
    });
    const strictVeg = person({ food: 'vegan', pets: 'have' });
    expect(compatibility(strictVeg, b).score).toBe(0);
    expect(compatibility(a, b).score).toBeGreaterThan(0); // pets love/no 0.33, veg/non-veg 0.33
  });
});

describe('deal-breakers (FR-DISC-02)', () => {
  it('a deal-breaker of either member below the line removes the pair', () => {
    const smoker = person({ smoking: 'yes' });
    const strict = person({}, { importance: { smoking: 'dealbreaker' } });
    expect(dealbreakerConflicts(strict, smoker)).toEqual(['smoking']);
    expect(dealbreakerConflicts(smoker, strict)).toEqual(['smoking']);
    // "Outside only" is half way: on the line, not below it.
    expect(dealbreakerConflicts(strict, person({ smoking: 'outside_only' }))).toEqual([]);
    // No deal-breakers, however different.
    expect(dealbreakerConflicts(person(), smoker)).toEqual([]);
  });

  it('an attribute that cannot be compared never conflicts', () => {
    const strict = person({}, { importance: { drinking: 'dealbreaker' } });
    expect(dealbreakerConflicts(strict, person({ drinking: undefined }))).toEqual([]);
  });
});

describe('Rishta report facts (FR-DISC-05)', () => {
  it('top 3 agreements by weight × similarity, then the biodata order', () => {
    const a = person({}, { importance: { food: 'dont_care', cleaning: 'dont_care' } });
    const b = person({ bedtime: '01:00', smoking: 'yes' }, { importance: { food: 'dont_care' } });
    const facts = rishtaFacts(a, b);
    // All agreeing attributes weigh 2 except food (0.5); bedtime and smoking are gaps.
    expect(facts.agreements.map((x) => x.attribute)).toEqual(['wake_time', 'cleaning', 'pets']);
    expect(facts.agreements).toHaveLength(3);
    expect(facts.perAttribute.food).toBe(1);
    expect(facts.perAttribute.bedtime).toBe(0);
  });

  it('the biggest gap is the weakest attribute, the heavier one on a tie, with both values', () => {
    const a = person({}, { importance: { smoking: 'dont_care' } });
    const b = person({ smoking: 'yes', pets: 'no' }, { importance: { smoking: 'dont_care' } });
    // smoking 0 (weight 0.5) vs pets 0.33 (weight 2): the weakest wins.
    expect(rishtaFacts(a, b).biggestGap).toEqual({
      attribute: 'smoking',
      similarity: 0,
      you: 'no',
      them: 'yes',
    });
    // Equal similarity: the heavier attribute.
    const c = person(
      { smoking: 'yes', cleaning: 'rarely' },
      { importance: { smoking: 'dont_care' } },
    );
    expect(rishtaFacts(a, c).biggestGap?.attribute).toBe('cleaning');
  });

  it('no gap when everything agrees; the viewer is "you"', () => {
    expect(rishtaFacts(person(), person()).biggestGap).toBeUndefined();
    const facts = rishtaFacts(person({ pets: 'no' }), person({ pets: 'have' }));
    expect(facts.biggestGap).toMatchObject({ attribute: 'pets', you: 'no', them: 'have' });
  });

  it.each([
    ['bedtime', '23:00'],
    ['wake_time', '07:00'],
    ['cleaning', 'daily'],
    ['smoking', 'no'],
    ['pets', 'love'],
    ['food', 'veg'],
    ['cooks_at_home', 'yes'],
    ['drinking', 'rarely'],
    ['guests', 'sometimes'],
    ['parties', 'rarely'],
    ['work_mode', 'hybrid'],
  ] as [LifestyleAttribute, string][])('names %s as %s', (attribute, value) => {
    expect(lifestyleValue(base, attribute)).toBe(value);
  });

  it('names a missing optional value as null, and "no" for not cooking', () => {
    const bare: Lifestyle = {
      bedtime: '23:00',
      wakeTime: '07:00',
      cleaning: 'daily',
      smoking: 'no',
      pets: 'ok',
      food: 'veg',
    };
    for (const attribute of [
      'cooks_at_home',
      'drinking',
      'guests',
      'parties',
      'work_mode',
    ] as const)
      expect(lifestyleValue(bare, attribute)).toBeNull();
    expect(lifestyleValue({ ...bare, cooksAtHome: false }, 'cooks_at_home')).toBe('no');
  });
});

describe('ranking (FR-DISC-07)', () => {
  const now = new Date('2026-11-28T12:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  const card = (over: Partial<Parameters<typeof rankScore>[0]> = {}) => ({
    score: 80,
    isVerified: false,
    lastActiveAt: daysAgo(30),
    createdAt: daysAgo(100),
    impressions: 500,
    ...over,
  });

  it('adds small boosts to the score', () => {
    expect(rankScore(card(), now)).toBe(80);
    expect(rankScore(card({ isVerified: true }), now)).toBe(80 + RANK_BOOST.verified);
    expect(rankScore(card({ lastActiveAt: daysAgo(7) }), now)).toBe(80 + RANK_BOOST.recentlyActive);
    expect(rankScore(card({ lastActiveAt: daysAgo(7.01) }), now)).toBe(80);
    expect(rankScore(card({ createdAt: daysAgo(14), impressions: 49 }), now)).toBe(
      80 + RANK_BOOST.underExposed,
    );
    expect(rankScore(card({ createdAt: daysAgo(14), impressions: 50 }), now)).toBe(80);
    expect(rankScore(card({ createdAt: daysAgo(15), impressions: 0 }), now)).toBe(80);
    expect(rankScore(card({ isBoosted: true }), now)).toBe(80 + RANK_BOOST.boosted);
  });

  it('never lets the boosts beat a much better match', () => {
    const all =
      RANK_BOOST.verified +
      RANK_BOOST.recentlyActive +
      RANK_BOOST.underExposed +
      RANK_BOOST.boosted;
    expect(all).toBeLessThan(15);
  });

  it('orders by rank, keeping the incoming order on ties', () => {
    const a = { ...card({ score: 70 }), id: 'a' };
    const b = { ...card({ score: 90 }), id: 'b' };
    const c = { ...card({ score: 70 }), id: 'c' };
    const d = { ...card({ score: 68, isVerified: true }), id: 'd' };
    expect(rankCandidates([a, b, c, d], now).map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('women-only visibility (FR-SAFE-04)', () => {
  const woman = { isIdentityVerified: true, verifiedGender: 'female' as const };
  const man = { isIdentityVerified: true, verifiedGender: 'male' as const };
  const unverified = { isIdentityVerified: false, verifiedGender: null };
  // A stale gender without verification never counts (only DigiLocker sets it).
  const staleFemale = { isIdentityVerified: false, verifiedGender: 'female' as const };
  const womenOnly = { category: 'women_only' as const };
  const professional = { category: 'professional' as const };

  it('women-only members are seen only by DigiLocker-verified women', () => {
    expect(canSee(woman, womenOnly)).toBe(true);
    expect(canSee(man, womenOnly)).toBe(false);
    expect(canSee(unverified, womenOnly)).toBe(false);
    expect(canSee(staleFemale, womenOnly)).toBe(false);
    expect(canSee({ isIdentityVerified: true, verifiedGender: 'transgender' }, womenOnly)).toBe(
      false,
    );
  });

  it('everyone else is visible to everyone', () => {
    for (const viewer of [woman, man, unverified]) expect(canSee(viewer, professional)).toBe(true);
    expect(isVerifiedWoman(woman)).toBe(true);
    expect(isVerifiedWoman(staleFemale)).toBe(false);
  });

  it('the response filter drops what the viewer may not see, keeping the order', () => {
    const list = [
      { id: 1, ...professional },
      { id: 2, ...womenOnly },
      { id: 3, category: 'student' as const },
    ];
    expect(visibleTo(man, list).map((x) => x.id)).toEqual([1, 3]);
    expect(visibleTo(woman, list).map((x) => x.id)).toEqual([1, 2, 3]);
  });
});
