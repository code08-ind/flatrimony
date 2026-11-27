/**
 * The listing editor and My Flat on the client (T3.9; FR-LST-01..09; docs/06 §8.12; designs
 * M28–M33): the six steps, what each step needs before Next, the draft each step edits and how it
 * maps to the API (docs/05 §8.6), the status chip, and what refused writes tell the owner. Pure and
 * unit-tested; the screens call it.
 */
import type { MessageKey } from '@flatrimony/i18n';
import {
  LISTING_LIMITS,
  inNcr,
  trueMonthlyPerPersonInr,
  type CreateListingRequest,
  type LatLng,
  type ListingCosts,
  type ListingPatch,
  type ListingRules,
  type OwnerListing,
} from '@flatrimony/shared';

export const LISTING_STEPS = ['basics', 'money', 'rules', 'photos', 'video', 'review'] as const;
export type ListingStep = (typeof LISTING_STEPS)[number];
export const stepIndex = (step: ListingStep) => LISTING_STEPS.indexOf(step);

// ------------------------------------------------------------------ Basics (M28)

/** What the Basics step edits; strings as typed, so a half-written field can stay on screen. */
export interface BasicsDraft {
  title: string;
  description: string;
  areaId: number | null;
  location: LatLng | null;
  /** What the owner picked on the map search, shown instead of coordinates. */
  locationLabel: string | null;
  address: string;
  bhk: number;
  roomType: 'private' | 'shared';
  furnishing: 'unfurnished' | 'semi_furnished' | 'furnished';
  availableFrom: string | null;
  minLeaseMonths: number;
  totalFlatmates: number;
  currentFlatmates: number;
}

export function basicsFrom(listing: OwnerListing | null): BasicsDraft {
  return {
    title: listing?.title ?? '',
    description: listing?.description ?? '',
    areaId: listing?.areaId ?? null,
    location: listing?.location ?? null,
    locationLabel: null,
    address: listing?.address ?? '',
    bhk: listing?.bhk ?? 2,
    roomType: listing?.roomType ?? 'private',
    furnishing: listing?.furnishing ?? 'semi_furnished',
    availableFrom: listing?.availableFrom ?? null,
    minLeaseMonths: listing?.minLeaseMonths ?? 11,
    totalFlatmates: listing?.totalFlatmates ?? 3,
    currentFlatmates: listing?.currentFlatmates ?? 2,
  };
}

/** Why the Basics step cannot go on yet (the first problem, as a message), or null. */
export function basicsProblem(d: BasicsDraft): MessageKey | null {
  const title = [...d.title.trim()].length;
  if (title < LISTING_LIMITS.titleMinChars || title > LISTING_LIMITS.titleMaxChars)
    return 'listing.editor.basics.errors.title';
  if (d.areaId === null) return 'listing.editor.basics.errors.area';
  if (!d.location) return 'listing.editor.basics.errors.location';
  if (!inNcr(d.location)) return 'listing.editor.basics.errors.outsideNcr';
  if (!d.availableFrom) return 'listing.editor.basics.errors.availableFrom';
  if (d.currentFlatmates >= d.totalFlatmates) return 'listing.editor.basics.errors.flatmates';
  if ([...d.description.trim()].length > LISTING_LIMITS.descriptionMaxChars)
    return 'listing.editor.basics.errors.description';
  if ([...d.address.trim()].length > LISTING_LIMITS.addressMaxChars)
    return 'listing.editor.basics.errors.address';
  return null;
}

/** The first write: a new draft with the Basics and placeholder money (Money comes next). */
export function createRequest(d: BasicsDraft, money: MoneyDraft): CreateListingRequest {
  return {
    title: d.title.trim(),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    areaId: d.areaId!,
    location: d.location!,
    ...(d.address.trim() ? { address: d.address.trim() } : {}),
    bhk: d.bhk,
    roomType: d.roomType,
    furnishing: d.furnishing,
    availableFrom: d.availableFrom!,
    minLeaseMonths: d.minLeaseMonths,
    offersVideoTour: false,
    totalFlatmates: d.totalFlatmates,
    currentFlatmates: d.currentFlatmates,
    rentPerPersonInr: inr(money.rent) ?? DEFAULT_RENT,
    depositPerPersonInr: inr(money.deposit) ?? 0,
  };
}

/** Only what changed (JSON Merge Patch: `null` clears), or null when nothing did. */
export function basicsPatch(listing: OwnerListing, d: BasicsDraft): ListingPatch | null {
  const patch: Record<string, unknown> = {};
  const set = <K extends keyof ListingPatch>(k: K, v: ListingPatch[K], old: unknown) => {
    if (JSON.stringify(v) !== JSON.stringify(old)) patch[k] = v;
  };
  set('title', d.title.trim(), listing.title);
  set('description', d.description.trim() || null, listing.description);
  set('areaId', d.areaId!, listing.areaId);
  set('location', d.location!, listing.location);
  set('address', d.address.trim() || null, listing.address);
  set('bhk', d.bhk, listing.bhk);
  set('roomType', d.roomType, listing.roomType);
  set('furnishing', d.furnishing, listing.furnishing);
  set('availableFrom', d.availableFrom!, listing.availableFrom);
  set('minLeaseMonths', d.minLeaseMonths, listing.minLeaseMonths);
  set('totalFlatmates', d.totalFlatmates, listing.totalFlatmates);
  set('currentFlatmates', d.currentFlatmates, listing.currentFlatmates);
  return Object.keys(patch).length ? (patch as ListingPatch) : null;
}

// ------------------------------------------------------------------ Money (M29)

/** A placeholder rent for the first save, before the Money step (any valid value; never shown). */
const DEFAULT_RENT = 10_000;

export interface MoneyDraft {
  /** Typed digits; empty while editing. */
  rent: string;
  deposit: string;
  maintenance: string;
  electricity: string;
  wifi: string;
  help: string;
  other: string;
  oneTime: { label: string; amount: string }[];
}

/**
 * What an amount field keeps as the owner types: the whole rupees only. A decimal part is dropped,
 * never run into the digits ("18000.5" is 18000, not 180005); commas and spaces go.
 */
export const wholeRupeesTyped = (text: string) => text.split('.')[0]!.replace(/[^0-9]/g, '');

/** A whole number of rupees from typed text (digits and Indian grouping commas), or null. */
export function inr(text: string): number | null {
  const digits = text.replace(/[,\s₹]/g, '');
  if (!/^[0-9]{1,9}$/.test(digits)) return null;
  return Number(digits);
}

export function moneyFrom(listing: OwnerListing | null): MoneyDraft {
  const c = listing?.costs;
  const str = (n: number | undefined) => (n === undefined ? '' : String(n));
  return {
    // A rent still at the placeholder of the first save is shown empty.
    rent: listing && listing.costs ? String(listing.rentPerPersonInr) : '',
    deposit: listing && listing.costs ? String(listing.depositPerPersonInr) : '',
    maintenance: str(c?.maintenanceInr),
    electricity: str(c?.electricityEstimateInr),
    wifi: str(c?.wifiInr),
    help: str(c?.helpInr),
    other: str(c?.otherRecurringInr),
    oneTime: (c?.oneTimeCosts ?? []).map((o) => ({ label: o.label, amount: String(o.amountInr) })),
  };
}

const RECURRING = ['maintenance', 'electricity', 'wifi', 'help', 'other'] as const;

export function moneyProblem(m: MoneyDraft): MessageKey | null {
  const rent = inr(m.rent);
  if (rent === null || rent < 1000 || rent > 200_000) return 'listing.editor.money.errors.rent';
  const deposit = inr(m.deposit);
  if (deposit === null || deposit > 1_000_000) return 'listing.editor.money.errors.deposit';
  for (const k of RECURRING) {
    const v = m[k].trim() === '' ? 0 : inr(m[k]);
    if (v === null || v > 100_000) return 'listing.editor.money.errors.recurring';
  }
  for (const o of m.oneTime) {
    const label = [...o.label.trim()].length;
    const amount = inr(o.amount);
    if (label < 1 || label > 40 || amount === null || amount > 1_000_000)
      return 'listing.editor.money.errors.oneTime';
  }
  return null;
}

export function costsFrom(m: MoneyDraft): ListingCosts {
  const n = (s: string) => (s.trim() === '' ? 0 : (inr(s) ?? 0));
  return {
    maintenanceInr: n(m.maintenance),
    electricityEstimateInr: n(m.electricity),
    wifiInr: n(m.wifi),
    helpInr: n(m.help),
    otherRecurringInr: n(m.other),
    oneTimeCosts: m.oneTime.map((o) => ({ label: o.label.trim(), amountInr: n(o.amount) })),
  };
}

/** The live "all-in monthly cost per person" (FR-LST-03), or null until the rent is typed. */
export function liveTrueMonthly(m: MoneyDraft): number | null {
  const rent = inr(m.rent);
  return rent === null ? null : trueMonthlyPerPersonInr(rent, costsFrom(m));
}

// ------------------------------------------------------------------ Rules (M30)

export const DEFAULT_RULES: ListingRules = {
  bachelorsAllowed: true,
  foodRule: 'any',
  guestsRule: 'day_only',
  petsAllowed: false,
  smokingAllowed: false,
  genderRule: 'any',
};

// ------------------------------------------------------------------ progress and status

/** Which steps are done, from what the API says is missing. */
export function stepsDone(listing: OwnerListing | null): Record<ListingStep, boolean> {
  const missing = new Set(listing?.missing ?? []);
  return {
    basics: !!listing,
    money: !!listing && !missing.has('costs'),
    rules: !!listing && !missing.has('rules'),
    photos: !!listing && !missing.has('photos'),
    video: !!listing && !missing.has('video'),
    review: !!listing && listing.status !== 'draft',
  };
}

/** Where "Continue" opens a draft: the first step not done yet. */
export function listingResumeStep(listing: OwnerListing | null): ListingStep {
  const done = stepsDone(listing);
  return LISTING_STEPS.find((s) => !done[s]) ?? 'review';
}

export type StatusChip =
  | { kind: 'active'; daysLeft: number }
  | { kind: 'draft' | 'review' | 'paused' | 'expired' | 'removed' };

/** "Active · expires in 4 days", "Draft", "In review"… (docs/06 §8.12). */
export function statusChip(listing: OwnerListing, nowMs: number): StatusChip {
  switch (listing.status) {
    case 'active': {
      const left = listing.expiresAt ? Date.parse(listing.expiresAt) - nowMs : 0;
      return { kind: 'active', daysLeft: Math.max(0, Math.ceil(left / 86_400_000)) };
    }
    case 'pending_review':
      return { kind: 'review' };
    default:
      return { kind: listing.status };
  }
}

/** What an owner can do with a listing in this status (docs/05 §8.6 transitions). */
export function listingActions(listing: OwnerListing) {
  const s = listing.status;
  return {
    edit: s !== 'removed',
    confirm: s === 'active' || s === 'expired',
    pause: s === 'active',
    // An expired listing comes back with "Still available" (the same thing as resuming it).
    resume: s === 'paused',
    continueDraft: s === 'draft',
    delete: true,
  };
}

/** The cover photo: the lowest position (the first in the grid). */
export function coverPhotoUrl(listing: OwnerListing): string | null {
  const photos = listing.media
    .filter((m) => m.kind === 'photo' && m.moderationStatus !== 'rejected')
    .sort((a, b) => a.position - b.position);
  return photos[0]?.url ?? null;
}

/** The next free photo position (photos sit at 0–11), or null when there are 12. */
export function nextPhotoPosition(listing: OwnerListing): number | null {
  const taken = new Set(listing.media.filter((m) => m.kind === 'photo').map((m) => m.position));
  for (let p = 0; p < LISTING_LIMITS.photosMax; p++) if (!taken.has(p)) return p;
  return null;
}

// ------------------------------------------------------------------ errors

/** What a refused listing write tells the owner (docs/05 §13; §8.6). */
export function listingErrorKey(status: number | 'network', body?: unknown): MessageKey {
  if (status === 'network') return 'listing.editor.errors.network';
  const code = (body as { code?: string } | null)?.code;
  switch (code) {
    case 'listing.not_allowed_for_intent':
      return 'listing.editor.errors.notHaveRoom';
    case 'verification.required':
      return 'listing.editor.errors.verify';
    case 'listing.incomplete':
      return 'listing.editor.errors.incomplete';
    case 'listing.brokerage_not_allowed':
      return 'listing.editor.errors.brokerage';
    case 'account.suspended':
      return 'listing.editor.errors.suspended';
    case 'precondition.failed':
      return 'listing.editor.errors.changed';
    case 'rate_limited':
      return 'listing.editor.errors.tooMany';
    case 'validation.failed':
      return 'listing.editor.errors.invalid';
    case 'conflict':
      return 'listing.editor.errors.conflict';
    case 'not_found':
      return 'listing.editor.errors.notFound';
  }
  if (status === 503) return 'listing.editor.errors.unavailable';
  return 'listing.editor.errors.generic';
}

// ------------------------------------------------------------------ web → Android (FR-LST-05)

const LISTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The link that opens a draft at the Video step in the Android app (`flatrimony://listings/{id}/
 * video`; docs/05 §8.6, FR-LST-05): what the web's "Continue on your phone" QR code holds. Only a
 * listing id goes in it (no personal data); null for anything that is not one.
 */
export function walkthroughAppLink(listingId: string): string | null {
  return LISTING_ID.test(listingId)
    ? `flatrimony://listings/${listingId.toLowerCase()}/video`
    : null;
}
