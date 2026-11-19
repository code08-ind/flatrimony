/** Account bootstrap, profile edits and consents (docs/05 §8.2, §8.15; FR-AUTH-06/08/09, FR-BIO-01/08). */
import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { AppLocale, Category, ConsentPurpose, Intent, Platform } from '../enums.js';
import { humanText, IsoDate, IsoDateTime, isWellFormedText, LanguageCode } from '../primitives.js';

/** Terms and Privacy Policy must be accepted to have an account; withdrawing them means deletion. */
export const REQUIRED_CONSENTS = ['terms', 'privacy'] as const satisfies readonly z.infer<
  typeof ConsentPurpose
>[];

/** A policy version as published, e.g. '2026-11-01' (public.consents.version). */
export const PolicyVersion = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, 'Invalid version');

export const ConsentGrant = z.object({ purpose: ConsentPurpose, version: PolicyVersion }).strict();
export type ConsentGrant = z.infer<typeof ConsentGrant>;

/** App version as the client reports it (public.devices.app_version). */
const AppVersion = z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,4}$/, 'Expected MAJOR.MINOR.PATCH');

export const DeviceRegistration = z
  .object({
    /** Installation id; HMAC'd by the API, never stored raw. */
    deviceId: z.string().min(8).max(200),
    platform: Platform,
    appVersion: AppVersion,
    // Printable ASCII only (Expo tokens are); a NUL byte would also fail in Postgres (QA T2.5 D1).
    pushToken: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[\x21-\x7E]+$/, 'Printable characters without spaces')
      .optional(),
    /** Play Integrity token; checked by the API (not stored). */
    integrityToken: z.string().min(1).max(20_000).optional(),
  })
  .strict();
export type DeviceRegistration = z.infer<typeof DeviceRegistration>;

export const BootstrapRequest = z
  .object({
    displayName: humanText(LIMITS.displayNameMaxChars),
    /** Self-declared until DigiLocker verification replaces it (FR-VER-03). 18+ is checked by the API. */
    dateOfBirth: IsoDate,
    intent: Intent,
    /** `women_only` is accepted before verification; the profile stays invisible until verified female. */
    category: Category,
    locale: AppLocale,
    consents: z
      .array(ConsentGrant)
      .min(1)
      .max(ConsentPurpose.options.length)
      .refine((list) => new Set(list.map((c) => c.purpose)).size === list.length, {
        message: 'Each purpose once',
      }),
    device: DeviceRegistration,
  })
  .strict();
export type BootstrapRequest = z.infer<typeof BootstrapRequest>;

/** PATCH /me (JSON Merge Patch: present fields change; `null` clears a nullable field). */
export const MePatch = z
  .object({
    displayName: humanText(LIMITS.displayNameMaxChars),
    bio: z
      .string()
      .trim()
      .refine(
        (s) => [...s].length <= LIMITS.bioMaxChars,
        `At most ${LIMITS.bioMaxChars} characters`,
      )
      // Line breaks are fine in a bio; other control characters and broken characters are not
      // (a NUL byte made Postgres fail with a 500, QA T2.5 D1/D4).
      .refine(
        // eslint-disable-next-line no-control-regex -- matching control characters is the point
        (s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(s),
        'Contains characters that cannot be shown',
      )
      .refine(isWellFormedText, 'Contains characters that cannot be shown')
      .nullable(),
    languages: z
      .array(LanguageCode)
      .max(LIMITS.languagesMax)
      .refine((l) => new Set(l).size === l.length, 'Languages must be unique'),
    locale: AppLocale,
    intent: Intent,
    category: Category,
    /** Student category only. */
    collegeName: humanText(LIMITS.collegeNameMaxChars).nullable(),
    courseEndDate: IsoDate.nullable(),
    isPaused: z.boolean(),
  })
  .partial()
  // "Nothing to change" ({}) is checked by the API, so a rejected unknown key is the only error.
  .strict();
export type MePatch = z.infer<typeof MePatch>;

export const ConsentRecord = z.object({
  purpose: ConsentPurpose,
  version: PolicyVersion,
  grantedAt: IsoDateTime,
  withdrawnAt: IsoDateTime.optional(),
});
export type ConsentRecord = z.infer<typeof ConsentRecord>;

export const ConsentsResponse = z.object({
  /** Every grant, newest first (history included). */
  consents: z.array(ConsentRecord),
  /** The version a client must accept now, per purpose. */
  currentVersions: z.partialRecord(ConsentPurpose, PolicyVersion),
});
export type ConsentsResponse = z.infer<typeof ConsentsResponse>;

/**
 * Biodata completion (0–100) shown in the completion ring (docs/06 §8; FR-AUTH-06 AC: the six
 * onboarding steps reach 40 %). Initial weights; the founder may tune them.
 */
export const BIODATA_WEIGHTS = {
  basics: 10, //            name, date of birth, intent, category (bootstrap)
  preferences: 10, //       budget and move-in window
  anchorOrAreas: 10, //     office/college anchor, or at least one preferred area
  lifestyle: 10, //         the five core habit answers
  photos: 20, //            at least one photo
  bio: 10,
  languages: 5,
  importance: 10, //        at least one importance set
  scenarios: 10, //         at least one scenario answer
  identityVerified: 5, //   DigiLocker
} as const;

export type BiodataParts = Record<keyof typeof BIODATA_WEIGHTS, boolean>;

export function biodataCompletion(parts: BiodataParts): number {
  let total = 0;
  for (const [key, weight] of Object.entries(BIODATA_WEIGHTS)) {
    if (parts[key as keyof BiodataParts]) total += weight;
  }
  return Math.min(100, total);
}

/** PUT /me/scenario-answers: upsert answers (FR-BIO-06). Unknown questions or options are 422. */
export const ScenarioAnswersRequest = z
  .array(
    z
      .object({
        questionId: z.string().min(1).max(64),
        optionId: z.string().min(1).max(64),
      })
      .strict(),
  )
  .min(1)
  .max(LIMITS.scenarioAnswersPerRequest)
  .refine((list) => new Set(list.map((a) => a.questionId)).size === list.length, {
    message: 'Each question once',
  });
export type ScenarioAnswersRequest = z.infer<typeof ScenarioAnswersRequest>;

// ------------------------------------------------------------------ photos (docs/05 §8.3; T2.10)

/** Upload limit per photo (docs/05 §8.3). */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export const PhotoUploadUrlRequest = z
  .object({
    contentType: z.enum(['image/jpeg', 'image/webp']),
    sizeBytes: z.number().int().positive().max(PHOTO_MAX_BYTES),
  })
  .strict();
export type PhotoUploadUrlRequest = z.infer<typeof PhotoUploadUrlRequest>;

export const PhotoUploadUrlResponse = z.object({
  /** PUT the file here (signed, single object). */
  uploadUrl: z.url(),
  /** Pass back to POST /me/photos. */
  storageKey: z.string().min(1),
  expiresAt: IsoDateTime,
});
export type PhotoUploadUrlResponse = z.infer<typeof PhotoUploadUrlResponse>;

export const PhotoConfirmRequest = z
  .object({
    storageKey: z.string().min(1).max(200),
    position: z
      .number()
      .int()
      .min(0)
      .max(LIMITS.profilePhotos.max - 1),
  })
  .strict();
export type PhotoConfirmRequest = z.infer<typeof PhotoConfirmRequest>;

export const PhotoOrderRequest = z
  .object({
    photoIds: z
      .array(z.uuid())
      .min(1)
      .max(LIMITS.profilePhotos.max)
      .refine((ids) => new Set(ids).size === ids.length, 'Each photo once'),
  })
  .strict();
export type PhotoOrderRequest = z.infer<typeof PhotoOrderRequest>;
