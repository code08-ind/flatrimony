/**
 * Profile tab and Flat Biodata editor (T2.11; docs/06 §8.13, designs M34/M35) as pure functions:
 * labels for saved answers, the importance controls, the photo resize plan and request bodies.
 */
import {
  LIMITS,
  type ImportanceMap,
  type Lifestyle,
  type Me,
  type Preferences,
} from '@flatrimony/shared';
import type { MessageKey } from '@flatrimony/i18n';
import { saveErrorKey, BEDTIMES, WAKE_TIMES } from '@flatrimony/client';

/** Languages offered in the editor (ISO 639-1); the API accepts any valid code. */
export const LANGUAGE_CODES = [
  'hi',
  'en',
  'pa',
  'bn',
  'ta',
  'te',
  'mr',
  'gu',
  'kn',
  'ml',
  'ur',
  'or',
] as const;

/** The habits whose importance the editor sets (the six core answers, FR-BIO-05). */
export const IMPORTANCE_ATTRIBUTES = [
  'smoking',
  'bedtime',
  'wake_time',
  'cleaning',
  'pets',
  'food',
] as const satisfies readonly (keyof ImportanceMap)[];
export const IMPORTANCE_LEVELS = ['dealbreaker', 'matters', 'dont_care'] as const;
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

/** Unset attributes count as `matters` (FR-BIO-05). */
export const importanceOf = (map: ImportanceMap, attribute: keyof ImportanceMap) =>
  (map[attribute] ?? 'matters') as ImportanceLevel;

/** The levels that differ from the default (for comparing two maps). */
export function importanceBody(map: ImportanceMap): ImportanceMap {
  return Object.fromEntries(
    Object.entries(map).filter(([, level]) => level && level !== 'matters'),
  ) as ImportanceMap;
}

/**
 * The map to save: every attribute the editor shows with an explicit level, so a user who keeps
 * "Matters" everywhere still records a choice (the completion part counts saved rows). Attributes
 * the editor does not show keep their saved level.
 */
export function importanceToSave(map: ImportanceMap): ImportanceMap {
  return {
    ...map,
    ...Object.fromEntries(IMPORTANCE_ATTRIBUTES.map((a) => [a, importanceOf(map, a)])),
  };
}

/** Unsaved importance: a level changed, or nothing was ever saved (Save confirms the defaults). */
export const importanceDirty = (local: ImportanceMap, saved: ImportanceMap) =>
  !sameImportance(local, saved) || Object.keys(saved).length === 0;

/** A stable value for "the saved importance changed" (resetting the local choices). */
export const importanceKey = (map: ImportanceMap) =>
  JSON.stringify(Object.entries(importanceBody(map)).sort(([a], [b]) => a.localeCompare(b)));

export function sameImportance(a: ImportanceMap, b: ImportanceMap): boolean {
  const x = importanceBody(a);
  const y = importanceBody(b);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => x[k as keyof ImportanceMap] === y[k as keyof ImportanceMap]);
}

/**
 * Message keys for the six saved core habits, in screen order; a time not offered as a chip
 * (set elsewhere) is shown as the time itself.
 */
export function habitLabels(
  l: Lifestyle,
): { attribute: MessageKey; key?: MessageKey; text?: string }[] {
  const bed = BEDTIMES.find((b) => b.time === l.bedtime);
  const wake = WAKE_TIMES.find((w) => w.time === l.wakeTime);
  const key = (k: string) => ({ key: `onboarding.habits.${k}` as MessageKey });
  const attr = (a: string) => ({ attribute: `onboarding.habits.${a}` as MessageKey });
  return [
    { ...attr('bedtime'), ...(bed ? key(bed.id) : { text: l.bedtime }) },
    { ...attr('wakeTime'), ...(wake ? key(wake.id) : { text: l.wakeTime }) },
    { ...attr('cleaning'), ...key(l.cleaning) },
    { ...attr('smoking'), ...key(l.smoking) },
    { ...attr('pets'), ...key(l.pets === 'no' ? 'no_pets' : l.pets) },
    { ...attr('food'), ...key(l.food) },
  ];
}

/** Initials for an avatar without a photo. */
export const initials = (name: string) =>
  [...name.trim()].find((c) => /\S/u.test(c))?.toUpperCase() ?? '?';

/** Longer side down to the stored size before upload (smaller upload; the API scales again). */
export const PHOTO_UPLOAD_MAX_SIDE = 1600;
export function resizeFor(
  width: number,
  height: number,
  max = PHOTO_UPLOAD_MAX_SIDE,
): { width: number } | { height: number } | null {
  if (width <= max && height <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/** Same members, any order. */
export const sameSet = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Same answers (keys with undefined values count as absent). */
export function sameAnswers(a: object, b: object): boolean {
  const clean = (o: object) =>
    JSON.stringify(
      Object.entries(o)
        .filter(([, v]) => v !== undefined && v !== null)
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  return clean(a) === clean(b);
}

/**
 * Toggle a language, refusing to add beyond the server limit (docs/05: at most 10). Returns the new
 * list, or null when the add was refused.
 */
export function toggleLanguage(
  current: readonly string[],
  code: string,
  max: number = LIMITS.languagesMax,
): string[] | null {
  if (current.includes(code)) return current.filter((c) => c !== code);
  return current.length >= max ? null : [...current, code];
}

/** The move-in window has ended: a preferences save would be refused until new dates are picked. */
export const moveInWindowOver = (prefs: Pick<Preferences, 'moveInTo'>, today: string) =>
  prefs.moveInTo < today;

/** The photo shown as the avatar: the first one that was not rejected in review. */
export const avatarPhoto = (me: Pick<Me, 'photos'>) =>
  me.photos.find((p) => p.moderationStatus !== 'rejected');

/** PUT /me/preferences keeps everything saved and changes only the given fields. */
export function preferencesWith(saved: Preferences, change: Partial<Preferences>): Preferences {
  return { ...saved, ...change };
}

/** The ids in a new order with `photoId` first (make main photo). */
export function withMainFirst(ids: string[], photoId: string): string[] {
  return [photoId, ...ids.filter((id) => id !== photoId)];
}

export const canAddPhoto = (me: Pick<Me, 'photos'>) => me.photos.length < LIMITS.profilePhotos.max;

/** Message for a failed photo request (docs/05 §8.3, §13), per operation. */
export function photoErrorKey(
  status: number,
  body: unknown,
  operation: 'add' | 'reorder' | 'remove' = 'add',
): MessageKey {
  const code = (body as { code?: string } | null)?.code;
  if (status === 412) return 'profile.editor.changedElsewhere';
  if (status === 429 || code === 'rate_limited') return 'auth.errors.tooManyRequests';
  if (status === 503) return 'profile.photos.errors.notAvailable';
  if (operation === 'remove')
    return status === 409 ? 'profile.photos.errors.keepOne' : 'profile.photos.errors.removeFailed';
  if (operation === 'reorder') return 'profile.photos.errors.reorderFailed';
  const field = (body as { errors?: { code?: string }[] } | null)?.errors?.[0]?.code;
  if (field === 'too_large') return 'profile.photos.errors.tooLarge';
  if (field === 'unsupported_format' || field === 'not_an_image' || field === 'animated')
    return 'profile.photos.errors.format';
  return 'profile.photos.errors.failed';
}

/** A language's name in the app language, or its code when the editor does not list it. */
export function languageName(t: (key: MessageKey) => string, code: string): string {
  return (LANGUAGE_CODES as readonly string[]).includes(code)
    ? t(`profile.languages.${code as (typeof LANGUAGE_CODES)[number]}`)
    : code.toUpperCase();
}

/**
 * Message for a failed profile edit. Like onboarding, except that a 412 means the profile changed
 * on another device and a 503 is not "sign-up isn't open".
 */
export function profileSaveErrorKey(
  status: number | 'network',
  code?: string,
  fieldCodes: string[] = [],
): MessageKey {
  if (status === 412) return 'profile.editor.changedElsewhere';
  if (status === 503) return 'profile.editor.unavailable';
  return saveErrorKey(status, code, fieldCodes);
}
