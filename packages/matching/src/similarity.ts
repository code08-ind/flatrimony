/**
 * Per-attribute similarity, 0 (opposite) to 1 (the same), for two members' self-ratings (spec §5.1
 * step 2; FR-DISC-03).
 *
 * The spec fixes two of these: bedtime (1.0 within 30 minutes, 0.5 within 90, 0 beyond) and
 * cleaning (distance on its 4-step scale). The others follow the same idea: an ordered scale is
 * scored by distance, and an unordered one by a small table. Those scales and tables are technical
 * starting points for founder sign-off (docs/07 T4.1), to be replaced by learned weights in v2
 * (spec §5.1).
 */
import type { Lifestyle, LifestyleAttribute } from '@flatrimony/shared';

/** Minutes since midnight of an "HH:mm" time. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** Distance between two times of day across midnight ("23:30" and "00:15" are 45 minutes apart). */
export function clockDistance(a: string, b: string): number {
  const d = Math.abs(minutesOf(a) - minutesOf(b));
  return Math.min(d, 24 * 60 - d);
}

/** Spec §5.1: 1.0 within 30 minutes, 0.5 within 90 minutes, 0 beyond. */
export function timeSimilarity(a: string, b: string): number {
  const d = clockDistance(a, b);
  if (d <= 30) return 1;
  if (d <= 90) return 0.5;
  return 0;
}

/** Distance on an ordered scale: the same step is 1, the far ends are 0. */
export function scaleSimilarity<T extends string>(scale: readonly T[], a: T, b: T): number {
  const steps = scale.length - 1;
  return 1 - Math.abs(scale.indexOf(a) - scale.indexOf(b)) / steps;
}

/**
 * A symmetric table of unordered values from its pairs (every pair of different values listed
 * once); the same value is always 1.
 */
export function pairTable<T extends string>(
  pairs: readonly (readonly [T, T, number])[],
): (a: T, b: T) => number {
  const scores = new Map<string, number>();
  for (const [x, y, score] of pairs) {
    scores.set(`${x}|${y}`, score);
    scores.set(`${y}|${x}`, score);
  }
  return (a, b) => (a === b ? 1 : scores.get(`${a}|${b}`)!);
}

export const CLEANING_SCALE = ['daily', 'few_times_week', 'weekly', 'rarely'] as const;
export const SMOKING_SCALE = ['no', 'outside_only', 'yes'] as const;
export const FREQUENCY_SCALE = ['never', 'rarely', 'sometimes', 'often'] as const;

/**
 * Pets: someone with a pet gets on with someone who loves pets; "OK with pets" is a step away; "no
 * pets" against a pet owner is the clash.
 */
export const PETS = pairTable<Lifestyle['pets']>([
  ['have', 'love', 1],
  ['have', 'ok', 0.67],
  ['have', 'no', 0],
  ['love', 'ok', 0.67],
  ['love', 'no', 0.33],
  ['ok', 'no', 0.67],
]);

/**
 * Food: kitchens are shared, so the distance between diets is how much one has to accommodate the
 * other (vegan and non-veg furthest apart).
 */
export const FOOD = pairTable<Lifestyle['food']>([
  ['veg', 'vegan', 0.67],
  ['veg', 'eggetarian', 0.67],
  ['veg', 'non_veg', 0.33],
  ['eggetarian', 'vegan', 0.33],
  ['eggetarian', 'non_veg', 0.67],
  ['vegan', 'non_veg', 0],
]);

/** Work patterns: a night shift clashes with everyone's quiet hours; office and WFH differ by day. */
export const WORK_MODE = pairTable<NonNullable<Lifestyle['workMode']>>([
  ['office', 'hybrid', 0.75],
  ['office', 'wfh', 0.5],
  ['office', 'student', 0.75],
  ['office', 'night_shift', 0.25],
  ['hybrid', 'wfh', 0.75],
  ['hybrid', 'student', 0.75],
  ['hybrid', 'night_shift', 0.25],
  ['wfh', 'student', 0.5],
  ['wfh', 'night_shift', 0.25],
  ['student', 'night_shift', 0.25],
]);

/**
 * The similarity of one attribute, or null when either member left an optional attribute empty
 * (that attribute then does not count, neither for nor against).
 */
export function attributeSimilarity(
  attribute: LifestyleAttribute,
  a: Lifestyle,
  b: Lifestyle,
): number | null {
  switch (attribute) {
    case 'bedtime':
      return timeSimilarity(a.bedtime, b.bedtime);
    case 'wake_time':
      return timeSimilarity(a.wakeTime, b.wakeTime);
    case 'cleaning':
      return scaleSimilarity(CLEANING_SCALE, a.cleaning, b.cleaning);
    case 'smoking':
      return scaleSimilarity(SMOKING_SCALE, a.smoking, b.smoking);
    case 'pets':
      return PETS(a.pets, b.pets);
    case 'food':
      return FOOD(a.food, b.food);
    case 'cooks_at_home':
      // Different cooking habits are not a clash, just less in common.
      return a.cooksAtHome === undefined || b.cooksAtHome === undefined
        ? null
        : a.cooksAtHome === b.cooksAtHome
          ? 1
          : 0.5;
    case 'drinking':
      return a.drinking && b.drinking
        ? scaleSimilarity(FREQUENCY_SCALE, a.drinking, b.drinking)
        : null;
    case 'guests':
      return a.guests && b.guests ? scaleSimilarity(FREQUENCY_SCALE, a.guests, b.guests) : null;
    case 'parties':
      return a.parties && b.parties ? scaleSimilarity(FREQUENCY_SCALE, a.parties, b.parties) : null;
    case 'work_mode':
      return a.workMode && b.workMode ? WORK_MODE(a.workMode, b.workMode) : null;
  }
}
