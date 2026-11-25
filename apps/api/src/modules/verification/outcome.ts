/**
 * Deciding a DigiLocker result (docs/05 §8.4), as pure functions. The checks run in a fixed order
 * so the answer reveals as little as possible: a banned identity is refused before anything else
 * is looked at, and someone else's account is only mentioned for an adult with a clean record.
 */
import { ageOn, LIMITS, type VerificationFailureCode } from '@flatrimony/shared';

/** Words of a name, compared without case or Latin accents; Devanagari keeps its vowel signs. */
function words(name: string): string[] {
  const latinPlain = name.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  return (latinPlain.toLocaleLowerCase('en-IN').match(/[\p{L}\p{M}]+/gu) ?? []).filter(Boolean);
}

/**
 * FR-VER-03: the display name must reasonably match the verified name. The first word of the
 * display name must be one of the verified name's words, or one of them must start with the other
 * (at least 3 letters: "Abhi" for "Abhishek", "Priya" for "Priyanka"). DigiLocker names are often
 * in capitals and carry middle names and surnames; the display name is just a first name.
 */
export function firstNameMatches(displayName: string, verifiedName: string): boolean {
  const first = words(displayName)[0];
  if (!first) return false;
  return words(verifiedName).some(
    (w) =>
      w === first ||
      (Math.min(w.length, first.length) >= 3 && (w.startsWith(first) || first.startsWith(w))),
  );
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
export function decideOutcome(input: OutcomeInput): VerificationFailureCode | null {
  if (input.banned) return 'banned';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth) || input.dateOfBirth < '1900-01-01')
    return 'provider_error';
  if (input.dateOfBirth > input.today || ageOn(input.dateOfBirth, input.today) < LIMITS.minAge)
    return 'underage';
  if (input.inUseElsewhere) return 'identity_in_use';
  if (!firstNameMatches(input.displayName, input.verifiedName)) return 'name_mismatch';
  return null;
}
