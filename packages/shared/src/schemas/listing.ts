/**
 * Listings (docs/05 §7, §8.6; FR-LST-01..09): the owner's requests and views. Mirrors the checks
 * of migration 0011 (docs/04 §15.6) so a bad value is a 422 with a field path, not a 500.
 */
import { z } from 'zod';
import {
  Furnishing,
  FoodRule,
  GenderPreference,
  GuestsRule,
  ListingStatus,
  MediaKind,
  ModerationStatus,
  RoomType,
} from '../enums.js';
import {
  displayText,
  IsoDate,
  IsoDateTime,
  isWellFormedText,
  LatLng,
  Uuid,
} from '../primitives.js';
import { PHOTO_MAX_BYTES, PhotoUploadUrlResponse } from './me.js';

/**
 * Words that put a broker on the platform (FR-LST-03; no landlords or brokers): a one-time cost may
 * not name them (the database's valid_one_time_costs has the plain list). Listing text is checked by
 * the automatic listing checks instead (FR-LST-08), since "no brokerage" is an honest thing to write.
 * Labels are folded first so look-alikes do not slip through: full-width letters (NFKC), Cyrillic
 * and Greek look-alike letters, digits for letters, and spaces or symbols between letters.
 */
const BROKERAGE =
  /broker|brokrage|dalal|dalaal|commis+ion|comis+ion|agent|agency|finder|ब्रोकर|दलाल|कमीशन|कमिशन/;
const LOOKALIKES: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  к: 'k',
  м: 'm',
  т: 't',
  н: 'h',
  в: 'b',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ɡ: 'g',
  ο: 'o',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ρ: 'p',
  τ: 't',
  χ: 'x',
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};
const fold = (text: string) =>
  [...text.normalize('NFKC').toLowerCase()]
    .map((c) => LOOKALIKES[c] ?? c)
    .join('')
    // Keep letters and Devanagari marks; drop spaces, digits left over, dots, dashes, zero-widths.
    .replace(/[^\p{L}\p{M}]/gu, '');
export const mentionsBrokerage = (text: string) => BROKERAGE.test(fold(text));

/** Delhi NCR with a margin (the database's listings_location_ncr_chk; docs/04 §15.6). */
export const NCR_BOUNDS = { minLat: 27.8, maxLat: 29.2, minLng: 76.5, maxLng: 78.0 } as const;
export const inNcr = ({ lat, lng }: LatLng) =>
  lat >= NCR_BOUNDS.minLat &&
  lat <= NCR_BOUNDS.maxLat &&
  lng >= NCR_BOUNDS.minLng &&
  lng <= NCR_BOUNDS.maxLng;

const ListingLocation = LatLng.refine(inNcr, 'Pick a place in Delhi NCR');

/** Free text people read, line breaks allowed (as the bio): 1..max characters. */
function longText(max: number) {
  return (
    z
      .string()
      .trim()
      .refine((s) => {
        const n = [...s].length;
        return n >= 1 && n <= max;
      }, `Must be 1 to ${max} characters`)
      .refine(
        // eslint-disable-next-line no-control-regex -- matching control characters is the point
        (s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(s),
        'Contains characters that cannot be shown',
      )
      .refine(isWellFormedText, 'Contains characters that cannot be shown')
      // At least one character that shows (not only zero-width ones; QA T3.5).
      .refine((s) => /[^\s\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]/u.test(s), 'Write something')
  );
}

export const LISTING_LIMITS = {
  titleMinChars: 5,
  titleMaxChars: 80,
  descriptionMaxChars: 1000,
  addressMaxChars: 300,
  photosMin: 3,
  photosMax: 12,
  /** Days a confirmation keeps a listing live (FR-LST-07). */
  confirmDays: 7,
} as const;

const ListingTitle = displayText(LISTING_LIMITS.titleMaxChars).refine(
  (s) => [...s].length >= LISTING_LIMITS.titleMinChars,
  `At least ${LISTING_LIMITS.titleMinChars} characters`,
);

const listingFields = {
  title: ListingTitle,
  description: longText(LISTING_LIMITS.descriptionMaxChars).nullable(),
  areaId: z.number().int().positive().max(32767),
  /** The exact pin: private (FR-LST-06); others see a point rounded to ~500 m. */
  location: ListingLocation,
  /** The full address: encrypted at rest, shown only to the owner (and a match after sharing). */
  address: longText(LISTING_LIMITS.addressMaxChars).nullable(),
  bhk: z.number().int().min(1).max(6),
  roomType: RoomType,
  furnishing: Furnishing,
  availableFrom: IsoDate,
  minLeaseMonths: z.number().int().min(1).max(36),
  totalFlatmates: z.number().int().min(2).max(10),
  currentFlatmates: z.number().int().min(1).max(9),
  rentPerPersonInr: z.number().int().min(1000).max(200_000),
  depositPerPersonInr: z.number().int().min(0).max(1_000_000),
  offersVideoTour: z.boolean(),
};

const flatmatesFit = (l: { totalFlatmates?: number; currentFlatmates?: number }) =>
  l.totalFlatmates === undefined ||
  l.currentFlatmates === undefined ||
  l.currentFlatmates < l.totalFlatmates;
const flatmatesIssue = {
  path: ['currentFlatmates'],
  message: 'Fewer people live there now than the flat holds',
};

/** `POST /v1/listings`: a new draft (FR-LST-01, 02). */
export const CreateListingRequest = z
  .object({
    ...listingFields,
    description: listingFields.description.optional(),
    address: listingFields.address.optional(),
    minLeaseMonths: listingFields.minLeaseMonths.default(11),
    offersVideoTour: listingFields.offersVideoTour.default(false),
  })
  .strict()
  .refine(flatmatesFit, flatmatesIssue);
export type CreateListingRequest = z.infer<typeof CreateListingRequest>;

/** `PATCH /v1/listings/:id` (JSON Merge Patch: present fields change; `null` clears). */
export const ListingPatch = z
  .object(listingFields)
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change')
  .refine(flatmatesFit, flatmatesIssue);
export type ListingPatch = z.infer<typeof ListingPatch>;

/** House rules (FR-LST-04): all required; they act as hard filters in discovery. */
export const ListingRules = z
  .object({
    bachelorsAllowed: z.boolean(),
    foodRule: FoodRule,
    guestsRule: GuestsRule,
    petsAllowed: z.boolean(),
    smokingAllowed: z.boolean(),
    genderRule: GenderPreference,
  })
  .strict();
export type ListingRules = z.infer<typeof ListingRules>;

const MonthlyInr = z.number().int().min(0).max(100_000);

export const OneTimeCost = z
  .object({
    /** Never a broker's fee: the API answers `listing.brokerage_not_allowed` (mentionsBrokerage). */
    label: displayText(40),
    amountInr: z.number().int().min(0).max(1_000_000),
  })
  .strict();
export type OneTimeCost = z.infer<typeof OneTimeCost>;

/**
 * Each person's share of the monthly costs, plus one-time costs (FR-LST-03). There is no brokerage
 * field: Flatrimony is broker-free, so it is not even accepted as input (docs/05 §8.6).
 */
export const ListingCosts = z
  .object({
    maintenanceInr: MonthlyInr,
    electricityEstimateInr: MonthlyInr,
    wifiInr: MonthlyInr,
    helpInr: MonthlyInr,
    otherRecurringInr: MonthlyInr,
    oneTimeCosts: z.array(OneTimeCost).max(10),
  })
  .strict();
export type ListingCosts = z.infer<typeof ListingCosts>;

/** What a person pays each month: rent plus their share of the recurring costs (FR-LST-03). */
export function trueMonthlyPerPersonInr(
  rentPerPersonInr: number,
  costs: Pick<
    ListingCosts,
    'maintenanceInr' | 'electricityEstimateInr' | 'wifiInr' | 'helpInr' | 'otherRecurringInr'
  >,
): number {
  return (
    rentPerPersonInr +
    costs.maintenanceInr +
    costs.electricityEstimateInr +
    costs.wifiInr +
    costs.helpInr +
    costs.otherRecurringInr
  );
}

/** What a listing still needs before it can be submitted (docs/04 §8.4). */
export const ListingMissing = z.enum(['rules', 'costs', 'photos', 'video', 'verification']);
export type ListingMissing = z.infer<typeof ListingMissing>;

export const ListingMediaItem = z.object({
  id: Uuid,
  kind: MediaKind,
  position: z.number().int(),
  durationS: z.number().int().nullable(),
  moderationStatus: ModerationStatus,
  /** A 1-hour signed link; null when storage could not make one (reload later). */
  url: z.string().nullable(),
});
export type ListingMediaItem = z.infer<typeof ListingMediaItem>;

/** A listing as its owner sees it: everything, including the exact pin and the address. */
export const OwnerListing = z.object({
  id: Uuid,
  status: ListingStatus,
  title: z.string(),
  description: z.string().nullable(),
  areaId: z.number().int(),
  location: LatLng,
  /** What others see: the pin rounded to ~500 m (FR-LST-06). */
  approxLocation: LatLng,
  address: z.string().nullable(),
  bhk: z.number().int(),
  roomType: RoomType,
  furnishing: Furnishing,
  availableFrom: IsoDate,
  minLeaseMonths: z.number().int(),
  totalFlatmates: z.number().int(),
  currentFlatmates: z.number().int(),
  rentPerPersonInr: z.number().int(),
  depositPerPersonInr: z.number().int(),
  offersVideoTour: z.boolean(),
  rules: ListingRules.nullable(),
  costs: ListingCosts.nullable(),
  /** Rent plus recurring costs; null until the costs are filled in. */
  trueMonthlyPerPersonInr: z.number().int().nullable(),
  media: z.array(ListingMediaItem),
  /** Empty when the listing can be submitted. */
  missing: z.array(ListingMissing),
  lastConfirmedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
  publishedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OwnerListing = z.infer<typeof OwnerListing>;

export const OwnerListingList = z.object({ listings: z.array(OwnerListing) });
export type OwnerListingList = z.infer<typeof OwnerListingList>;

/** A walkthrough video is at most 25 MB (docs/05 §8.6; 90 s of 720p from the in-app recorder). */
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;

/** `POST /v1/listings/:id/media/upload-url`: where to PUT one photo or the walkthrough video. */
export const ListingMediaUploadUrlRequest = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('photo'),
      contentType: z.enum(['image/jpeg', 'image/webp']),
      sizeBytes: z.number().int().positive().max(PHOTO_MAX_BYTES),
    })
    .strict(),
  z
    .object({
      kind: z.literal('walkthrough_video'),
      contentType: z.literal('video/mp4'),
      sizeBytes: z.number().int().positive().max(VIDEO_MAX_BYTES),
    })
    .strict(),
]);
export type ListingMediaUploadUrlRequest = z.infer<typeof ListingMediaUploadUrlRequest>;

/** The same shape as profile photos: PUT the file to `uploadUrl`, then confirm `storageKey`. */
export const ListingMediaUploadUrlResponse = PhotoUploadUrlResponse;
export type ListingMediaUploadUrlResponse = z.infer<typeof ListingMediaUploadUrlResponse>;

/**
 * `POST /v1/listings/:id/media`: confirm an upload. A photo takes a position (0-11; a photo already
 * there is replaced). The video is recorded in the Android app, which sends its SHA-256, length,
 * capture time and a Play Integrity token bound to that hash (FR-LST-05).
 */
export const ListingMediaConfirmRequest = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('photo'),
      storageKey: z.string().min(1).max(200),
      position: z
        .number()
        .int()
        .min(0)
        .max(LISTING_LIMITS.photosMax - 1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('walkthrough_video'),
      storageKey: z.string().min(1).max(200),
      /** Lower-case hex SHA-256 of the file as uploaded. */
      sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lower-case hex SHA-256'),
      durationS: z.number().int().min(30).max(90),
      width: z.number().int().min(1).max(10000).optional(),
      height: z.number().int().min(1).max(10000).optional(),
      capturedAt: IsoDateTime,
      /** Gallery videos are not accepted (FR-LST-05). */
      recordedInApp: z.literal(true),
      integrityToken: z.string().min(1).max(8000),
    })
    .strict(),
]);
export type ListingMediaConfirmRequest = z.infer<typeof ListingMediaConfirmRequest>;
