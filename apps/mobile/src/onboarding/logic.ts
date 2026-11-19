/**
 * Onboarding (FR-AUTH-06; docs/06 §8.3) as pure functions, unit-tested without React Native:
 * which step to show, date helpers in India time, and the API request bodies.
 *
 * Flow: About you (name, date of birth; founder decision 2026-11-17, not counted in the six) →
 * 1 intent → 2 category → [POST /me/bootstrap] → 3 budget → 4 areas (office search: T2.8) →
 * 5 move-in → [PUT /me/preferences] → 6 habits → [PUT /me/lifestyle] → Discover.
 */
import {
  ageOn,
  LIMITS,
  type BootstrapRequest,
  type Category,
  type Intent,
  type Lifestyle,
  type Me,
  type Preferences,
} from '@flatrimony/shared';

export const STEPS = ['intent', 'category', 'budget', 'commute', 'move-in', 'habits'] as const;
export type Step = 'about' | (typeof STEPS)[number];

/** Every screen in order, About you first. */
export const ALL_STEPS: Step[] = ['about', ...STEPS];

/** True when `current` (a screen name) comes after `first` (the first unanswered step). */
export function stepAhead(current: string, first: Step): boolean {
  const i = ALL_STEPS.indexOf(current as Step);
  return i >= 0 && i > ALL_STEPS.indexOf(first);
}

/** 1-based position in the six counted steps (About you is not counted). */
export const stepNumber = (step: Step) => STEPS.indexOf(step as (typeof STEPS)[number]) + 1;

/** What the user has answered so far on this device (kept in memory until it is saved). */
export interface Draft {
  displayName?: string;
  dateOfBirth?: string;
  intent?: Intent;
  category?: Category;
  budgetMinInr?: number;
  budgetMaxInr?: number;
  areaIds?: number[];
  moveInFrom?: string;
  moveInTo?: string;
  leaseMonths?: number;
}

/** Onboarding is done when the six steps are saved: preferences, an anchor or areas, lifestyle. */
export function isComplete(me: Me | null): boolean {
  return (
    !!me && !!me.preferences && (!!me.anchor || me.preferences.areaIds.length > 0) && !!me.lifestyle
  );
}

/** The step to show: the first one not yet answered (saved on the server or in the draft). */
export function resumeStep(me: Me | null, draft: Draft): Step | null {
  if (!me) {
    if (!draft.displayName || !draft.dateOfBirth) return 'about';
    if (!draft.intent) return 'intent';
    return 'category';
  }
  if (!me.preferences) {
    if (draft.budgetMinInr === undefined) return 'budget';
    if (!draft.areaIds?.length) return 'commute';
    return 'move-in';
  }
  if (!me.anchor && me.preferences.areaIds.length === 0) return 'commute';
  if (!me.lifestyle) return 'habits';
  return null;
}

// ------------------------------------------------------------------ dates (India time)

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Today's date in India, YYYY-MM-DD. */
export const todayIst = (nowMs: number) =>
  new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (iso: string, days: number) =>
  toIso(new Date(toDate(iso).getTime() + days * DAY_MS));

export function endOfMonth(iso: string): string {
  const d = toDate(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function firstOfNextMonth(iso: string): string {
  const d = toDate(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
}

export const daysBetween = (from: string, to: string) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);

/**
 * Quick choices on the move-in screen (docs/designs M08). Initial windows, to be confirmed by the
 * founder: ASAP = the next 2 weeks; Flexible = the next 3 months.
 */
export type MoveInPreset = 'asap' | 'this_month' | 'next_month' | 'flexible';
export function presetWindow(preset: MoveInPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'asap':
      return { from: today, to: addDays(today, 14) };
    case 'this_month':
      return { from: today, to: endOfMonth(today) };
    case 'next_month': {
      const first = firstOfNextMonth(today);
      return { from: first, to: endOfMonth(first) };
    }
    case 'flexible':
      return { from: today, to: addDays(today, 90) };
  }
}

/** Weeks (Sunday first) of a month for the calendar; days outside the month are null. */
export function monthGrid(year: number, month0: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month0, 1));
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) cells.push(toIso(new Date(Date.UTC(year, month0, d))));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Tapping a day: the first tap starts a window; the second (on or after it) ends it. */
export function tapDay(
  window: { from?: string; to?: string },
  day: string,
): { from: string; to?: string } {
  if (!window.from || window.to || day < window.from) return { from: day };
  return { from: window.from, to: day };
}

// ------------------------------------------------------------------ About you

export type DobProblem = 'incomplete' | 'invalid' | 'underage' | 'too_old';

/** Day, month and year as typed → ISO date, or why not (18+ on today's date in India). */
export function parseDob(
  day: string,
  month: string,
  year: string,
  today: string,
): { ok: true; iso: string } | { ok: false; problem: DobProblem } {
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year))
    return { ok: false, problem: 'incomplete' };
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const d = toDate(iso);
  if (Number.isNaN(d.getTime()) || toIso(d) !== iso) return { ok: false, problem: 'invalid' };
  if (iso < '1900-01-01') return { ok: false, problem: 'too_old' };
  if (iso > today || ageOn(iso, today) < LIMITS.minAge) return { ok: false, problem: 'underage' };
  return { ok: true, iso };
}

// ------------------------------------------------------------------ budget

/** Quick brackets on the budget screen (docs/designs M06), rent share per month in ₹. */
export const BUDGET_BRACKETS = [
  { id: 'under_10k', min: 5_000, max: 10_000 },
  { id: '10_20k', min: 10_000, max: 20_000 },
  { id: '20_30k', min: 20_000, max: 30_000 },
  { id: '30k_plus', min: 30_000, max: 50_000 },
] as const;
export const BUDGET_STEP = 1_000;

export function clampBudget(min: number, max: number): { min: number; max: number } {
  const lo = Math.min(Math.max(min, LIMITS.budgetInr.min), LIMITS.budgetInr.max);
  const hi = Math.min(Math.max(max, lo), LIMITS.budgetInr.max);
  return { min: lo, max: hi };
}

/** ₹ amounts the Indian way: 150000 → "₹1,50,000". */
export const formatInr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// ------------------------------------------------------------------ habits

/**
 * Bedtime and wake-time chips map to a time of day (lifestyle.bedtime / wake_time). Wake time was
 * added to the designed habits screen by founder decision (2026-11-17; FR-BIO-04).
 */
export const BEDTIMES = [
  { id: 'by_10pm', time: '22:00' },
  { id: 'by_11pm', time: '23:00' },
  { id: 'by_12am', time: '00:00' },
  { id: 'after_1am', time: '01:00' },
] as const;
export const WAKE_TIMES = [
  { id: 'by_6am', time: '06:00' },
  { id: 'by_7am', time: '07:00' },
  { id: 'by_8am', time: '08:00' },
  { id: 'after_9am', time: '09:00' },
] as const;

export type HabitAnswers = Partial<
  Pick<Lifestyle, 'bedtime' | 'wakeTime' | 'cleaning' | 'smoking' | 'pets' | 'food'>
>;

export const habitsComplete = (h: HabitAnswers): h is Required<HabitAnswers> =>
  !!(h.bedtime && h.wakeTime && h.cleaning && h.smoking && h.pets && h.food);

// ------------------------------------------------------------------ request bodies

/** Not asked in onboarding: women-only members look for women flatmates, everyone else "any". */
export const genderPrefFor = (category: Category): Preferences['flatmateGenderPref'] =>
  category === 'women_only' ? 'female_only' : 'any';

export function bootstrapBody(
  draft: Draft,
  ctx: {
    locale: 'en' | 'hi';
    legalVersions: { terms?: string; privacy?: string };
    device: BootstrapRequest['device'];
  },
): BootstrapRequest | null {
  const { displayName, dateOfBirth, intent, category } = draft;
  const { terms, privacy } = ctx.legalVersions;
  if (!displayName || !dateOfBirth || !intent || !category || !terms || !privacy) return null;
  return {
    displayName,
    dateOfBirth,
    intent,
    category,
    locale: ctx.locale,
    // The user accepted the Terms and Privacy Policy on the welcome and phone screens.
    consents: [
      { purpose: 'terms', version: terms },
      { purpose: 'privacy', version: privacy },
    ],
    device: ctx.device,
  };
}

/**
 * The preferences to save: the draft's answers over what is already saved (after a restart the
 * draft only holds the steps answered since, the rest comes from the server).
 */
export function preferencesBody(
  draft: Draft,
  category: Category,
  saved?: Preferences,
): Preferences | null {
  const merged: Draft = {
    ...(saved
      ? {
          budgetMinInr: saved.budgetMinInr,
          budgetMaxInr: saved.budgetMaxInr,
          moveInFrom: saved.moveInFrom,
          moveInTo: saved.moveInTo,
          leaseMonths: saved.leaseMonths,
          areaIds: saved.areaIds,
        }
      : {}),
    ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined)),
  };
  const { budgetMinInr, budgetMaxInr, moveInFrom, moveInTo, areaIds } = merged;
  draft = merged;
  if (budgetMinInr === undefined || budgetMaxInr === undefined || !moveInFrom || !moveInTo)
    return null;
  return {
    budgetMinInr,
    budgetMaxInr,
    moveInFrom,
    moveInTo,
    leaseMonths: draft.leaseMonths ?? LIMITS.leaseMonths.default,
    flatmateGenderPref: genderPrefFor(category),
    areaIds: areaIds ?? [],
  };
}
