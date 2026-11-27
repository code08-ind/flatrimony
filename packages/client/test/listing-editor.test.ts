import { describe, expect, it } from 'vitest';
import { messages } from '@flatrimony/i18n';
import type { OwnerListing } from '@flatrimony/shared';
import {
  basicsFrom,
  basicsPatch,
  basicsProblem,
  costsFrom,
  coverPhotoUrl,
  createRequest,
  inr,
  listingActions,
  listingErrorKey,
  liveTrueMonthly,
  moneyFrom,
  moneyProblem,
  nextPhotoPosition,
  listingResumeStep,
  statusChip,
  stepsDone,
  walkthroughAppLink,
  type BasicsDraft,
  type MoneyDraft,
} from '../src/index.js';

const NOW = Date.parse('2026-11-27T10:00:00Z');
const listing = (over: Partial<OwnerListing> = {}): OwnerListing => ({
  id: '7d4f3a2e-5b6c-4d7e-8f90-1a2b3c4d5e6f',
  status: 'draft',
  title: 'Sunny room near Cyber Hub',
  description: null,
  areaId: 3,
  location: { lat: 28.4951, lng: 77.0889 },
  approxLocation: { lat: 28.495, lng: 77.09 },
  address: null,
  bhk: 3,
  roomType: 'private',
  furnishing: 'semi_furnished',
  availableFrom: '2026-12-15',
  minLeaseMonths: 11,
  totalFlatmates: 3,
  currentFlatmates: 2,
  rentPerPersonInr: 10000,
  depositPerPersonInr: 0,
  offersVideoTour: false,
  rules: null,
  costs: null,
  trueMonthlyPerPersonInr: null,
  media: [],
  missing: ['rules', 'costs', 'photos', 'video', 'verification'],
  lastConfirmedAt: null,
  expiresAt: null,
  publishedAt: null,
  createdAt: '2026-11-27T09:00:00.000Z',
  updatedAt: '2026-11-27T09:00:00.000Z',
  ...over,
});
const basics = (over: Partial<BasicsDraft> = {}): BasicsDraft => ({
  ...basicsFrom(listing()),
  ...over,
});
const money = (over: Partial<MoneyDraft> = {}): MoneyDraft => ({
  rent: '18,000',
  deposit: '36000',
  maintenance: '1500',
  electricity: '1200',
  wifi: '',
  help: '1000',
  other: '0',
  oneTime: [{ label: 'Setup', amount: '2000' }],
  ...over,
});

describe('Basics (M28)', () => {
  it('names the first thing missing, in order', () => {
    expect(basicsProblem(basics())).toBeNull();
    expect(basicsProblem(basics({ title: 'Room' }))).toBe('listing.editor.basics.errors.title');
    expect(basicsProblem(basics({ areaId: null }))).toBe('listing.editor.basics.errors.area');
    expect(basicsProblem(basics({ location: null }))).toBe('listing.editor.basics.errors.location');
    expect(basicsProblem(basics({ location: { lat: 12.97, lng: 77.59 } }))).toBe(
      'listing.editor.basics.errors.outsideNcr',
    );
    expect(basicsProblem(basics({ availableFrom: null }))).toBe(
      'listing.editor.basics.errors.availableFrom',
    );
    expect(basicsProblem(basics({ currentFlatmates: 3 }))).toBe(
      'listing.editor.basics.errors.flatmates',
    );
    expect(basicsProblem(basics({ description: 'x'.repeat(1001) }))).toBe(
      'listing.editor.basics.errors.description',
    );
    expect(basicsProblem(basics({ address: 'x'.repeat(301) }))).toBe(
      'listing.editor.basics.errors.address',
    );
  });

  it('the first save carries the money typed so far, or a placeholder', () => {
    const req = createRequest(basics({ description: '  ', address: ' Tower B ' }), money());
    expect(req).toMatchObject({
      rentPerPersonInr: 18000,
      depositPerPersonInr: 36000,
      address: 'Tower B',
    });
    expect(req).not.toHaveProperty('description');
    expect(createRequest(basics(), money({ rent: '', deposit: '' }))).toMatchObject({
      rentPerPersonInr: 10000,
      depositPerPersonInr: 0,
    });
  });

  it('a patch has only what changed; emptied text clears it', () => {
    const l = listing({ description: 'Quiet flat', address: 'Tower B' });
    expect(basicsPatch(l, basicsFrom(l))).toBeNull();
    expect(basicsPatch(l, { ...basicsFrom(l), bhk: 2, description: '', address: '' })).toEqual({
      bhk: 2,
      description: null,
      address: null,
    });
  });
});

describe('Money (M29)', () => {
  it('reads rupees as typed (commas, ₹), refuses anything else', () => {
    expect(inr('18,000')).toBe(18000);
    expect(inr('₹ 1,20,000')).toBe(120000);
    expect(inr('12.5')).toBeNull();
    expect(inr('')).toBeNull();
    expect(inr('-1')).toBeNull();
  });

  it('checks the rent, deposit and costs, and adds up the all-in monthly cost', () => {
    expect(moneyProblem(money())).toBeNull();
    expect(moneyProblem(money({ rent: '500' }))).toBe('listing.editor.money.errors.rent');
    expect(moneyProblem(money({ deposit: '' }))).toBe('listing.editor.money.errors.deposit');
    expect(moneyProblem(money({ wifi: '200000' }))).toBe('listing.editor.money.errors.recurring');
    expect(moneyProblem(money({ oneTime: [{ label: '', amount: '5' }] }))).toBe(
      'listing.editor.money.errors.oneTime',
    );
    expect(costsFrom(money())).toEqual({
      maintenanceInr: 1500,
      electricityEstimateInr: 1200,
      wifiInr: 0,
      helpInr: 1000,
      otherRecurringInr: 0,
      oneTimeCosts: [{ label: 'Setup', amountInr: 2000 }],
    });
    expect(liveTrueMonthly(money())).toBe(18000 + 1500 + 1200 + 1000);
    expect(liveTrueMonthly(money({ rent: '' }))).toBeNull();
  });

  it('a draft without costs yet shows an empty rent (not the placeholder of the first save)', () => {
    expect(moneyFrom(listing()).rent).toBe('');
    const saved = listing({
      rentPerPersonInr: 18000,
      costs: costsFrom(money()),
    });
    expect(moneyFrom(saved)).toMatchObject({ rent: '18000', maintenance: '1500', wifi: '0' });
  });
});

describe('progress, status and actions (M33, My Flat)', () => {
  it('a draft continues at its first unfinished step', () => {
    expect(listingResumeStep(null)).toBe('basics');
    expect(listingResumeStep(listing())).toBe('money');
    expect(listingResumeStep(listing({ missing: ['photos', 'video'] }))).toBe('photos');
    expect(listingResumeStep(listing({ missing: ['verification'] }))).toBe('review');
    expect(stepsDone(listing({ status: 'active', missing: [] })).review).toBe(true);
  });

  it('the status chip counts the days left of a live listing', () => {
    expect(
      statusChip(listing({ status: 'active', expiresAt: '2026-12-01T09:00:00Z' }), NOW),
    ).toEqual({
      kind: 'active',
      daysLeft: 4,
    });
    expect(
      statusChip(listing({ status: 'active', expiresAt: '2026-11-27T09:00:00Z' }), NOW),
    ).toEqual({
      kind: 'active',
      daysLeft: 0,
    });
    expect(statusChip(listing({ status: 'pending_review' }), NOW)).toEqual({ kind: 'review' });
    expect(statusChip(listing({ status: 'paused' }), NOW)).toEqual({ kind: 'paused' });
  });

  it('offers only what the API allows in each status', () => {
    expect(listingActions(listing({ status: 'active' }))).toMatchObject({
      confirm: true,
      pause: true,
      resume: false,
    });
    expect(listingActions(listing({ status: 'expired' }))).toMatchObject({
      confirm: true,
      resume: false,
    });
    expect(listingActions(listing({ status: 'paused' }))).toMatchObject({
      confirm: false,
      resume: true,
    });
    expect(listingActions(listing({ status: 'pending_review' }))).toMatchObject({
      confirm: false,
      pause: false,
      resume: false,
    });
    expect(listingActions(listing({ status: 'removed' })).edit).toBe(false);
  });

  it('photos: the cover is the first; the next free position fills gaps', () => {
    const photo = (position: number, url: string | null = `u${position}`) => ({
      id: `00000000-0000-4000-8000-00000000000${position}`,
      kind: 'photo' as const,
      position,
      durationS: null,
      moderationStatus: 'pending' as const,
      url,
    });
    const l = listing({ media: [photo(2), photo(0), photo(3)] });
    expect(coverPhotoUrl(l)).toBe('u0');
    expect(nextPhotoPosition(l)).toBe(1);
    expect(
      nextPhotoPosition(listing({ media: Array.from({ length: 12 }, (_, i) => photo(i)) })),
    ).toBeNull();
    expect(coverPhotoUrl(listing())).toBeNull();
  });
});

describe('errors', () => {
  it('every refusal has its own message, in English and Hindi', () => {
    const codes = [
      'listing.not_allowed_for_intent',
      'verification.required',
      'listing.incomplete',
      'listing.brokerage_not_allowed',
      'account.suspended',
      'precondition.failed',
      'rate_limited',
      'validation.failed',
      'conflict',
      'not_found',
    ];
    const keys = new Set(codes.map((code) => listingErrorKey(400, { code })));
    expect(keys.size).toBe(codes.length);
    keys.add(listingErrorKey('network'));
    keys.add(listingErrorKey(503));
    keys.add(listingErrorKey(500));
    for (const key of keys)
      for (const locale of ['en', 'hi'] as const) {
        const text = key
          .split('.')
          .reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], messages[locale]);
        expect(typeof text, `${locale}:${key}`).toBe('string');
      }
  });
});

describe('the web → Android link (FR-LST-05)', () => {
  it('opens the draft at the Video step; nothing but a listing id goes in it', () => {
    const id = listing().id;
    expect(walkthroughAppLink(id)).toBe(`flatrimony://listings/${id}/video`);
    expect(walkthroughAppLink(id.toUpperCase())).toBe(`flatrimony://listings/${id}/video`);
    for (const bad of ['', 'abc', `${id}/../me`, `${id}?x=1`, 'javascript:alert(1)'])
      expect(walkthroughAppLink(bad)).toBeNull();
  });
});
