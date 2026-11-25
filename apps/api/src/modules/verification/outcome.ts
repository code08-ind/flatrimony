/**
 * Deciding a DigiLocker result (docs/05 §8.4), as pure functions. The checks run in a fixed order
 * so the answer reveals as little as possible: a banned identity is refused before anything else
 * is looked at, and someone else's account is only mentioned for an adult with a clean record.
 */
import { ageOn, LIMITS, type VerificationFailureCode } from '@flatrimony/shared';

/** Titles that are not names ("Dr. Anil", "Smt. Lakshmi Devi"). */
const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'prof',
  'shri',
  'sri',
  'smt',
  'shrimati',
  'kumari',
  'km',
  'late',
]);
/** The many spellings of Mohammad, as they appear on Indian documents. */
const MOHAMMAD = /^(mohd|md|moh|mohammed|mohammad|mohamad|mohamed|muhammad|muhammed|mohmmad)$/;

/** Words of a name: lower case, without Latin accents; Devanagari keeps its vowel signs. */
function words(name: string): string[] {
  const plain = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');
  return plain.toLocaleLowerCase('en-IN').match(/[\p{L}\p{M}]+/gu) ?? [];
}

/**
 * One spelling for common Latin variants of Indian names: Pooja/Puja, Laxmi/Lakshmi, Deepak/Dipak,
 * Bhavna/Bavna, Mohd/Mohammed. Only for comparing; never stored.
 */
function canonical(word: string): string {
  if (!/^[a-z]+$/.test(word)) return word;
  if (MOHAMMAD.test(word)) return 'mohammad';
  return word
    .replace(/ksh/g, 'x')
    .replace(/oo/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/([bdgjkt])h/g, '$1')
    .replace(/(.)\1+/g, '$1');
}

/** Name words that can be a given name: no titles, no single-letter initials ("A. Sharma"). */
const nameWords = (name: string) => words(name).filter((w) => w.length > 1 && !HONORIFICS.has(w));

/**
 * FR-VER-03: the display name must reasonably match the verified name. The display name's first
 * real word (titles and initials skipped) must match a word of the DigiLocker name: the same
 * after folding common spellings, or one starting with the other (at least 3 letters: "Abhi" for
 * "Abhishek"). Any word counts, because records put the given name first, last or after an
 * initial ("SHARMA ANITA", "K. RAMESH"). DigiLocker names are in Latin script, so a display name
 * in Devanagari does not match (founder decision pending, docs/07 T3.1).
 */
export function firstNameMatches(displayName: string, verifiedName: string): boolean {
  const first = nameWords(displayName)[0];
  if (!first) return false;
  const a = canonical(first);
  return nameWords(verifiedName).some((word) => {
    const b = canonical(word);
    return a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
  });
}

/** A real calendar date in YYYY-MM-DD ("1990-02-30" is not). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface OutcomeInput {
  displayName: string;
  verifiedName: string;
  /** YYYY-MM-DD from DigiLocker */
  dateOfBirth: string;
  /** Today in India, YYYY-MM-DD */
  today: string;
  banned: boolean;
  /** The DigiLocker identity already verifies another account. */
  inUseElsewhere: boolean;
}

/** null: verified. Otherwise the failure code to store and show. */
/**
 * An Aadhaar number (12 digits, maybe grouped by 4) where the DigiLocker id should be: never
 * accepted or stored, not even hashed (founder rule: DigiLocker only, never Aadhaar).
 */
export const looksLikeAadhaar = (id: string) => /^\s*\d{4}[\s-]?\d{4}[\s-]?\d{4}\s*$/.test(id);

export function decideOutcome(input: OutcomeInput): VerificationFailureCode | null {
  if (input.banned) return 'banned';
  if (!isCalendarDate(input.dateOfBirth) || input.dateOfBirth < '1900-01-01')
    return 'provider_error';
  if (input.dateOfBirth > input.today || ageOn(input.dateOfBirth, input.today) < LIMITS.minAge)
    return 'underage';
  if (input.inUseElsewhere) return 'identity_in_use';
  if (!firstNameMatches(input.displayName, input.verifiedName)) return 'name_mismatch';
  return null;
}
