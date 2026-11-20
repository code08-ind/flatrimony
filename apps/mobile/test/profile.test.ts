import { describe, expect, it } from 'vitest';
import { messages } from '@flatrimony/i18n';
import type { Lifestyle, Preferences } from '@flatrimony/shared';
import {
  avatarPhoto,
  canAddPhoto,
  habitLabels,
  IMPORTANCE_ATTRIBUTES,
  importanceBody,
  importanceDirty,
  importanceKey,
  importanceOf,
  importanceToSave,
  initials,
  languageName,
  LANGUAGE_CODES,
  moveInWindowOver,
  photoErrorKey,
  preferencesWith,
  profileSaveErrorKey,
  resizeFor,
  sameAnswers,
  sameImportance,
  sameSet,
  toggleLanguage,
  withMainFirst,
} from '../src/profile/logic';

const lookup = (key: string) =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages.en);

describe('importance (FR-BIO-05)', () => {
  it('unset means matters, and only non-default levels are saved', () => {
    expect(importanceOf({}, 'smoking')).toBe('matters');
    expect(importanceBody({ smoking: 'dealbreaker', pets: 'matters', food: 'dont_care' })).toEqual({
      smoking: 'dealbreaker',
      food: 'dont_care',
    });
  });
  it('saves every shown habit explicitly, so keeping "Matters" everywhere still counts', () => {
    const body = importanceToSave({ smoking: 'dealbreaker', drinking: 'dont_care' });
    expect(Object.keys(body).sort()).toEqual([...IMPORTANCE_ATTRIBUTES, 'drinking'].sort());
    expect(body.smoking).toBe('dealbreaker');
    expect(body.pets).toBe('matters');
    expect(body.drinking).toBe('dont_care'); // not shown in the editor: kept
  });
  it('is unsaved until something was saved once, then only when a level changed', () => {
    expect(importanceDirty({}, {})).toBe(true);
    expect(importanceDirty({ pets: 'matters' }, importanceToSave({}))).toBe(false);
    expect(importanceDirty({ pets: 'dont_care' }, importanceToSave({}))).toBe(true);
  });
  it('the reset key changes with the levels, not with a new object', () => {
    expect(importanceKey({ smoking: 'dealbreaker', food: 'matters' })).toBe(
      importanceKey({ food: 'matters', smoking: 'dealbreaker' }),
    );
    expect(importanceKey(importanceToSave({}))).toBe(importanceKey({}));
    expect(importanceKey({ smoking: 'dealbreaker' })).not.toBe(importanceKey({}));
  });
  it('compares maps ignoring defaults', () => {
    expect(sameImportance({}, { smoking: 'matters' })).toBe(true);
    expect(sameImportance({ smoking: 'dealbreaker' }, {})).toBe(false);
    expect(sameImportance({ pets: 'dont_care' }, { pets: 'dont_care', food: 'matters' })).toBe(
      true,
    );
  });
});

describe('habit labels', () => {
  const l: Lifestyle = {
    bedtime: '23:00',
    wakeTime: '06:30',
    cleaning: 'daily',
    smoking: 'outside_only',
    pets: 'no',
    food: 'non_veg',
  };
  it('map saved answers to existing message keys (time shown as is when not a chip)', () => {
    const labels = habitLabels(l);
    expect(labels[1]).toEqual({ attribute: 'onboarding.habits.wakeTime', text: '06:30' });
    for (const h of labels) {
      expect(typeof lookup(h.attribute), h.attribute).toBe('string');
      if (h.key) expect(typeof lookup(h.key), h.key).toBe('string');
    }
    expect(labels[4]!.key).toBe('onboarding.habits.no_pets');
  });
});

describe('photos', () => {
  it('scales the longer side down to 1600 px, never up', () => {
    expect(resizeFor(4000, 3000)).toEqual({ width: 1600 });
    expect(resizeFor(3000, 4000)).toEqual({ height: 1600 });
    expect(resizeFor(1600, 1200)).toBeNull();
  });
  it('make main moves a photo first; at most 6', () => {
    expect(withMainFirst(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(canAddPhoto({ photos: Array(5).fill({}) as never })).toBe(true);
    expect(canAddPhoto({ photos: Array(6).fill({}) as never })).toBe(false);
  });
  it('maps API errors to messages that exist, per operation', () => {
    const cases: [number, unknown, 'add' | 'reorder' | 'remove', string][] = [
      [422, { errors: [{ code: 'too_large' }] }, 'add', 'profile.photos.errors.tooLarge'],
      [422, { errors: [{ code: 'unsupported_format' }] }, 'add', 'profile.photos.errors.format'],
      [500, null, 'add', 'profile.photos.errors.failed'],
      [409, { code: 'conflict' }, 'remove', 'profile.photos.errors.keepOne'],
      [404, { code: 'not_found' }, 'remove', 'profile.photos.errors.removeFailed'],
      [422, { code: 'validation.failed' }, 'reorder', 'profile.photos.errors.reorderFailed'],
      [412, { code: 'precondition.failed' }, 'remove', 'profile.editor.changedElsewhere'],
      [503, {}, 'add', 'profile.photos.errors.notAvailable'],
      [429, { code: 'rate_limited' }, 'reorder', 'auth.errors.tooManyRequests'],
    ];
    for (const [status, body, op, key] of cases) {
      expect(photoErrorKey(status, body, op), `${status} ${op}`).toBe(key);
      expect(typeof lookup(key), key).toBe('string');
    }
  });
  it('the avatar skips photos rejected in review', () => {
    const photo = (id: string, moderationStatus: 'pending' | 'approved' | 'rejected') =>
      ({ id, url: `u/${id}`, position: 0, moderationStatus }) as never;
    expect(avatarPhoto({ photos: [photo('a', 'rejected'), photo('b', 'pending')] })).toMatchObject({
      id: 'b',
    });
    expect(avatarPhoto({ photos: [photo('a', 'rejected')] })).toBeUndefined();
  });
});

describe('basics', () => {
  it('language names come from messages; unknown codes are shown as codes', () => {
    const t = (k: string) => String(lookup(k));
    for (const code of LANGUAGE_CODES)
      expect(languageName(t as never, code)).not.toMatch(/^profile\./);
    expect(languageName(t as never, 'xx')).toBe('XX');
  });
  it('languages stop at the server limit; removing always works', () => {
    const ten = LANGUAGE_CODES.slice(0, 10) as unknown as string[];
    expect(toggleLanguage(ten, 'ur')).toBeNull();
    expect(toggleLanguage(ten, 'hi')).toHaveLength(9);
    expect(toggleLanguage(['hi'], 'en')).toEqual(['hi', 'en']);
  });
  it('change detection ignores order and absent answers', () => {
    expect(sameSet([1, 2], [2, 1])).toBe(true);
    expect(sameSet([1], [1, 2])).toBe(false);
    expect(sameAnswers({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameAnswers({ a: 1, b: 'x' }, { a: 1 })).toBe(false);
  });
  it('the move-in window is over the day after it ends', () => {
    expect(moveInWindowOver({ moveInTo: '2026-11-19' }, '2026-11-20')).toBe(true);
    expect(moveInWindowOver({ moveInTo: '2026-11-20' }, '2026-11-20')).toBe(false);
  });
  it('profile save errors: 412 and 503 have their own messages', () => {
    for (const [status, key] of [
      [412, 'profile.editor.changedElsewhere'],
      [503, 'profile.editor.unavailable'],
      [429, 'auth.errors.tooManyRequests'],
      ['network', 'onboarding.errors.save'],
    ] as const) {
      expect(profileSaveErrorKey(status)).toBe(key);
      expect(typeof lookup(key), key).toBe('string');
    }
  });
  it('initials', () => {
    expect(initials('  meera')).toBe('M');
    expect(initials('अर्जुन')).toBe('अ');
  });
  it('preferences edits keep everything else saved', () => {
    const saved: Preferences = {
      budgetMinInr: 10000,
      budgetMaxInr: 20000,
      moveInFrom: '2026-12-01',
      moveInTo: '2026-12-20',
      leaseMonths: 11,
      flatmateGenderPref: 'female_only',
      areaIds: [1, 2],
    };
    expect(preferencesWith(saved, { areaIds: [3] })).toEqual({ ...saved, areaIds: [3] });
  });
});
