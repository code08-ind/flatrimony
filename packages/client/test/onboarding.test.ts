import { describe, expect, it } from 'vitest';
import { BootstrapRequest, Me, Preferences, type Lifestyle } from '@flatrimony/shared';
import {
  addDays,
  bootstrapBody,
  clampBudget,
  daysBetween,
  endOfMonth,
  formatInr,
  habitsComplete,
  isComplete,
  monthGrid,
  parseDob,
  preferencesBody,
  presetWindow,
  resumeStep,
  stepAhead,
  stepNumber,
  tapDay,
  todayIst,
  type Draft,
  saveErrorKey,
  readMe,
} from '../src/index.js';

const baseMe = Me.parse({
  id: '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c',
  displayName: 'Karan',
  age: 24,
  intent: 'need_room',
  category: 'professional',
  languages: [],
  locale: 'en',
  isIdentityVerified: false,
  badges: [],
  isPaused: false,
  biodataCompletion: 10,
  photos: [],
  importance: {},
  entitlements: { movePass: { active: false } },
  createdAt: '2026-11-17T04:30:00.000Z',
});
const prefs: Preferences = {
  budgetMinInr: 10000,
  budgetMaxInr: 20000,
  moveInFrom: '2026-12-01',
  moveInTo: '2026-12-20',
  leaseMonths: 11,
  flatmateGenderPref: 'any',
  areaIds: [1],
};
const lifestyle: Lifestyle = {
  bedtime: '23:00',
  wakeTime: '07:00',
  cleaning: 'daily',
  smoking: 'no',
  pets: 'love',
  food: 'veg',
};

describe('where onboarding resumes', () => {
  it('walks the steps in order before the account exists', () => {
    expect(resumeStep(null, {})).toBe('about');
    expect(resumeStep(null, { displayName: 'K', dateOfBirth: '2000-01-01' })).toBe('intent');
    expect(
      resumeStep(null, { displayName: 'K', dateOfBirth: '2000-01-01', intent: 'need_room' }),
    ).toBe('category');
  });

  it('after bootstrap: budget → areas → move-in → habits → done', () => {
    expect(resumeStep(baseMe, {})).toBe('budget');
    expect(resumeStep(baseMe, { budgetMinInr: 1, budgetMaxInr: 2 })).toBe('commute');
    expect(resumeStep(baseMe, { budgetMinInr: 1, budgetMaxInr: 2, areaIds: [1] })).toBe('move-in');
    expect(resumeStep({ ...baseMe, preferences: prefs }, {})).toBe('habits');
    expect(resumeStep({ ...baseMe, preferences: { ...prefs, areaIds: [] } }, {})).toBe('commute');
    expect(resumeStep({ ...baseMe, preferences: prefs, lifestyle }, {})).toBeNull();
  });

  it('is complete only with preferences, areas or an anchor, and lifestyle', () => {
    expect(isComplete(null)).toBe(false);
    expect(isComplete({ ...baseMe, preferences: prefs })).toBe(false);
    expect(isComplete({ ...baseMe, preferences: prefs, lifestyle })).toBe(true);
    expect(isComplete({ ...baseMe, preferences: { ...prefs, areaIds: [] }, lifestyle })).toBe(
      false,
    );
    expect(
      isComplete({
        ...baseMe,
        preferences: { ...prefs, areaIds: [] },
        lifestyle,
        anchor: {
          kind: 'office',
          label: 'Office',
          location: { lat: 28.5, lng: 77.1 },
          travelMode: 'car',
          maxCommuteMin: 45,
        },
      }),
    ).toBe(true);
  });

  it('numbers the six counted steps', () => {
    expect(stepNumber('intent')).toBe(1);
    expect(stepNumber('habits')).toBe(6);
  });
});

describe('dates in India', () => {
  it('today and month arithmetic', () => {
    expect(todayIst(Date.parse('2026-11-16T19:00:00Z'))).toBe('2026-11-17');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(daysBetween('2026-12-01', '2026-12-20')).toBe(19);
  });

  it('move-in presets', () => {
    const today = '2026-11-17';
    expect(presetWindow('asap', today)).toEqual({ from: today, to: '2026-12-01' });
    expect(presetWindow('this_month', today)).toEqual({ from: today, to: '2026-11-30' });
    expect(presetWindow('next_month', today)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(presetWindow('next_month', '2026-12-05')).toEqual({
      from: '2027-01-01',
      to: '2027-01-31',
    });
    expect(presetWindow('flexible', today)).toEqual({ from: today, to: '2027-02-15' });
  });

  it('builds Sunday-first month grids', () => {
    const dec = monthGrid(2026, 11); // 1 Dec 2026 is a Tuesday
    expect(dec[0]).toEqual([
      null,
      null,
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
    ]);
    expect(dec.flat().filter(Boolean)).toHaveLength(31);
    expect(dec.every((w) => w.length === 7)).toBe(true);
  });

  it('tapping days makes a window', () => {
    let w = tapDay({}, '2026-12-05');
    expect(w).toEqual({ from: '2026-12-05' });
    w = tapDay(w, '2026-12-20');
    expect(w).toEqual({ from: '2026-12-05', to: '2026-12-20' });
    expect(tapDay(w, '2026-12-10')).toEqual({ from: '2026-12-10' }); // a full window restarts
    expect(tapDay({ from: '2026-12-05' }, '2026-12-01')).toEqual({ from: '2026-12-01' }); // earlier day restarts
    expect(tapDay({ from: '2026-12-05' }, '2026-12-05')).toEqual({
      from: '2026-12-05',
      to: '2026-12-05',
    });
  });
});

describe('date of birth', () => {
  const today = '2026-11-17';
  it('accepts real dates for adults (18+ on the date in India)', () => {
    expect(parseDob('17', '11', '2008', today)).toEqual({ ok: true, iso: '2008-11-17' });
    expect(parseDob('1', '2', '1995', today)).toEqual({ ok: true, iso: '1995-02-01' });
  });
  it.each([
    [['18', '11', '2008'], 'underage'],
    [['1', '1', '2030'], 'underage'],
    [['30', '2', '2000'], 'invalid'],
    [['31', '13', '2000'], 'invalid'],
    [['1', '1', '1899'], 'too_old'],
    [['', '1', '2000'], 'incomplete'],
    [['1', '1', '99'], 'incomplete'],
  ] as const)('%j → %s', ([d, m, y], problem) => {
    expect(parseDob(d, m, y, today)).toEqual({ ok: false, problem });
  });
});

describe('budget', () => {
  it('keeps min ≤ max inside the limits', () => {
    expect(clampBudget(500, 300_000)).toEqual({ min: 1000, max: 200_000 });
    expect(clampBudget(25_000, 20_000)).toEqual({ min: 25_000, max: 25_000 });
  });
  it('formats rupees the Indian way', () => {
    expect(formatInr(150000)).toBe('₹1,50,000');
  });
});

describe('request bodies', () => {
  const draft: Draft = {
    displayName: 'Karan',
    dateOfBirth: '2002-04-18',
    intent: 'need_room',
    category: 'women_only',
    budgetMinInr: 10000,
    budgetMaxInr: 20000,
    areaIds: [3, 5],
    moveInFrom: '2026-12-01',
    moveInTo: '2026-12-20',
  };
  const device = {
    deviceId: 'install-0f8e2c7a9b',
    platform: 'android' as const,
    appVersion: '1.0.0',
  };

  it('bootstrap: valid against the API contract, with the current legal versions', () => {
    const body = bootstrapBody(draft, {
      locale: 'hi',
      legalVersions: { terms: '2026-11-01', privacy: '2026-11-01' },
      device,
    });
    expect(BootstrapRequest.parse(body)).toMatchObject({
      locale: 'hi',
      category: 'women_only',
      consents: [
        { purpose: 'terms', version: '2026-11-01' },
        { purpose: 'privacy', version: '2026-11-01' },
      ],
    });
  });

  it('bootstrap: nothing to send without published versions or earlier answers', () => {
    expect(bootstrapBody(draft, { locale: 'en', legalVersions: {}, device })).toBeNull();
    expect(
      bootstrapBody(
        { ...draft, displayName: undefined },
        { locale: 'en', legalVersions: { terms: 'a', privacy: 'b' }, device },
      ),
    ).toBeNull();
  });

  it('preferences: valid; women-only members look for women flatmates', () => {
    expect(Preferences.parse(preferencesBody(draft, 'women_only'))).toMatchObject({
      leaseMonths: 11,
      flatmateGenderPref: 'female_only',
      areaIds: [3, 5],
    });
    expect(preferencesBody(draft, 'student')!.flatmateGenderPref).toBe('any');
    expect(preferencesBody({ ...draft, moveInTo: undefined }, 'student')).toBeNull();
  });

  it('habits need all six answers', () => {
    expect(habitsComplete({ ...lifestyle })).toBe(true);
    expect(habitsComplete({ ...lifestyle, wakeTime: undefined })).toBe(false);
  });
});

describe('save errors', () => {
  it('maps API problems to messages', () => {
    expect(saveErrorKey('network')).toBe('onboarding.errors.save');
    expect(saveErrorKey(403, 'auth.banned')).toBe('auth.errors.banned');
    expect(saveErrorKey(422, 'profile.underage')).toBe('onboarding.errors.underage');
    expect(saveErrorKey(503, 'upstream.unavailable')).toBe('onboarding.errors.notOpen');
    expect(saveErrorKey(503, 'auth.unavailable')).toBe('auth.errors.unavailable');
    expect(saveErrorKey(500)).toBe('onboarding.errors.generic');
  });
});

describe('review fixes (T2.6)', () => {
  it('a step ahead of the answers is not opened directly (reload, deep link)', () => {
    expect(stepAhead('category', 'about')).toBe(true);
    expect(stepAhead('about', 'category')).toBe(false); // going back is fine
    expect(stepAhead('move-in', 'move-in')).toBe(false);
    expect(stepAhead('habits', 'budget')).toBe(true);
    expect(stepAhead('index', 'about')).toBe(false); // not a step
  });

  it('preferences after a restart: saved values fill what the draft no longer has', () => {
    const body = preferencesBody(
      { moveInFrom: '2027-01-01', moveInTo: '2027-01-10' },
      'student',
      prefs,
    );
    expect(body).toMatchObject({
      budgetMinInr: 10000,
      budgetMaxInr: 20000,
      areaIds: [1],
      moveInFrom: '2027-01-01',
      moveInTo: '2027-01-10',
    });
    expect(preferencesBody({}, 'student')).toBeNull();
  });

  it('specific messages for an ended window and the women-only rule', () => {
    expect(saveErrorKey(422, 'validation.failed', ['in_the_past'])).toBe(
      'onboarding.errors.windowOver',
    );
    expect(saveErrorKey(403, 'profile.category_not_allowed')).toBe(
      'onboarding.errors.categoryNotAllowed',
    );
  });

  it('reads a profile with values this app does not know yet instead of locking the user out', () => {
    const future = {
      ...baseMe,
      category: 'senior_living',
      lifestyle: { ...lifestyle, food: 'jain' },
    };
    expect(readMe(future)?.id).toBe(baseMe.id);
    expect(readMe(baseMe)).toEqual(baseMe);
    expect(readMe({ nope: true })).toBeNull();
    expect(readMe(null)).toBeNull();
  });
});
