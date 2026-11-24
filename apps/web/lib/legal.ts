/**
 * The four legal pages (W07–W10) as content trees, generated from the exported designs by
 * scripts/extract-legal.py (drafts pending legal review, T0.15). Plain data: the page renders
 * only the tags it knows, so no HTML from a file ever reaches the browser.
 */
import type { Locale } from '@flatrimony/i18n';
import communityEn from '../content/legal/community-standards.en.json';
import communityHi from '../content/legal/community-standards.hi.json';
import privacyEn from '../content/legal/privacy.en.json';
import privacyHi from '../content/legal/privacy.hi.json';
import tenancyEn from '../content/legal/tenancy-guidelines.en.json';
import tenancyHi from '../content/legal/tenancy-guidelines.hi.json';
import termsEn from '../content/legal/terms.en.json';
import termsHi from '../content/legal/terms.hi.json';

export type LegalNode = string | { t: string; c?: LegalNode[] };
export interface LegalContent {
  title: string;
  intro: LegalNode[];
  sections: { title: string; blocks: LegalNode[] }[];
}

/** URL slug → content per language. */
export const LEGAL_PAGES = {
  terms: { en: termsEn, hi: termsHi },
  privacy: { en: privacyEn, hi: privacyHi },
  'community-standards': { en: communityEn, hi: communityHi },
  'tenancy-guidelines': { en: tenancyEn, hi: tenancyHi },
} as const satisfies Record<string, Record<Locale, LegalContent>>;

export type LegalPageId = keyof typeof LEGAL_PAGES;

export const legalContent = (page: LegalPageId, locale: Locale): LegalContent =>
  LEGAL_PAGES[page][locale];

/** Plain text of a node (titles, tests). */
export const textOf = (node: LegalNode): string =>
  typeof node === 'string' ? node : (node.c ?? []).map(textOf).join('');
