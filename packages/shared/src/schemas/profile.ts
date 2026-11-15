/** Flat Biodata resources (docs/05 §7, docs/02 E1/E2). */
import { z } from 'zod';
import { LIMITS } from '../constants.js';
import {
  AnchorKind,
  AppLocale,
  Category,
  CleaningLevel,
  FoodHabit,
  FrequencyLevel,
  GenderPreference,
  Importance,
  Intent,
  LifestyleAttribute,
  ModerationStatus,
  PetAttitude,
  SmokingHabit,
  TravelMode,
  WorkMode,
} from '../enums.js';
import { Inr, IsoDate, IsoDateTime, LatLng, TimeOfDay, Uuid } from '../primitives.js';

export const Badge = z.object({
  type: z.enum(['identity_verified', 'female_verified', 'work_verified', 'student_verified']),
});
export type Badge = z.infer<typeof Badge>;

export const Photo = z.object({
  id: Uuid,
  url: z.url(),
  position: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.profilePhotos.max - 1),
  moderationStatus: ModerationStatus,
});

export const Preferences = z
  .object({
    budgetMinInr: Inr,
    budgetMaxInr: Inr,
    moveInFrom: IsoDate,
    moveInTo: IsoDate,
    leaseMonths: z.number().int().positive(),
    flatmateGenderPref: GenderPreference,
    areaIds: z.array(z.number().int().positive()).max(LIMITS.preferredAreasMax),
  })
  .refine((p) => p.budgetMinInr <= p.budgetMaxInr, {
    path: ['budgetMaxInr'],
    message: 'Maximum budget must be at least the minimum',
  })
  .refine((p) => p.moveInFrom <= p.moveInTo, {
    path: ['moveInTo'],
    message: 'Move-in window must end on or after it starts',
  })
  .refine((p) => new Set(p.areaIds).size === p.areaIds.length, {
    path: ['areaIds'],
    message: 'Areas must be unique',
  });
export type Preferences = z.infer<typeof Preferences>;

export const Anchor = z.object({
  kind: AnchorKind,
  label: z.string().trim().min(1).max(120),
  location: LatLng,
  travelMode: TravelMode,
  maxCommuteMin: z
    .number()
    .int()
    .min(LIMITS.commuteMinutes.min)
    .max(LIMITS.commuteMinutes.max)
    .default(LIMITS.commuteMinutes.default),
});
export type Anchor = z.infer<typeof Anchor>;

/** First five attributes are P0 (FR-BIO-04); the rest are optional. */
export const Lifestyle = z.object({
  bedtime: TimeOfDay,
  wakeTime: TimeOfDay,
  cleaning: CleaningLevel,
  smoking: SmokingHabit,
  pets: PetAttitude,
  food: FoodHabit,
  cooksAtHome: z.boolean().optional(),
  drinking: FrequencyLevel.optional(),
  guests: FrequencyLevel.optional(),
  parties: FrequencyLevel.optional(),
  workMode: WorkMode.optional(),
});
export type Lifestyle = z.infer<typeof Lifestyle>;

/** Per-attribute importance; missing attributes default to `matters` (FR-BIO-05). */
export const ImportanceMap = z.partialRecord(LifestyleAttribute, Importance);
export type ImportanceMap = z.infer<typeof ImportanceMap>;

export const PassportSummary = z.object({
  identityVerified: z.boolean(),
  memberSince: IsoDate,
  badges: z.array(Badge),
  habitConfirmations: z.array(
    z.object({ tagId: z.string(), label: z.string(), confirmedBy: z.number().int().nonnegative() }),
  ),
  pastStays: z.number().int().nonnegative(),
  hasReferences: z.boolean(),
});

export const Me = z.object({
  id: Uuid,
  displayName: z.string().trim().min(1).max(50),
  age: z.number().int().min(LIMITS.minAge).nullable(),
  intent: Intent,
  category: Category,
  bio: z.string().max(LIMITS.bioMaxChars).optional(),
  languages: z.array(z.string().min(2).max(35)),
  locale: AppLocale,
  isIdentityVerified: z.boolean(),
  badges: z.array(Badge),
  isPaused: z.boolean(),
  biodataCompletion: z.number().int().min(0).max(100),
  photos: z.array(Photo).max(LIMITS.profilePhotos.max),
  preferences: Preferences.optional(),
  anchor: Anchor.optional(),
  lifestyle: Lifestyle.optional(),
  importance: ImportanceMap,
  entitlements: z.object({
    movePass: z.object({ active: z.boolean(), validUntil: IsoDateTime.optional() }),
  }),
  createdAt: IsoDateTime,
});
export type Me = z.infer<typeof Me>;

/**
 * What other users see. Deliberately has no phone, exact location, verified name, DOB or
 * identity fields (docs/05 §12). `.strict()` makes accidental extra fields a test failure.
 */
export const PublicProfile = z
  .object({
    id: Uuid,
    displayName: z.string().min(1).max(50),
    age: z.number().int().min(LIMITS.minAge).nullable(),
    category: Category,
    intent: Intent,
    bio: z.string().max(LIMITS.bioMaxChars).optional(),
    languages: z.array(z.string()),
    badges: z.array(Badge),
    photos: z.array(z.object({ id: Uuid, url: z.url() })).max(LIMITS.profilePhotos.max),
    lifestyle: Lifestyle,
    budget: z.object({ minInr: Inr, maxInr: Inr }),
    moveInFrom: IsoDate,
    commuteSummary: z
      .object({
        minutes: z.number().int().nonnegative(),
        travelMode: TravelMode,
        anchorLabel: z.string(),
      })
      .optional(),
    passport: PassportSummary,
  })
  .strict();
export type PublicProfile = z.infer<typeof PublicProfile>;

/** Age in whole years on `today` (IST date strings, YYYY-MM-DD). */
export function ageOn(dob: string, today: string): number {
  const [y1, m1, d1] = dob.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split('-').map(Number) as [number, number, number];
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}
