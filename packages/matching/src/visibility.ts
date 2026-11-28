/**
 * Women-only visibility (FR-SAFE-04; founder rule: "Women-only spaces are visible only to
 * DigiLocker-verified women"). The candidate SQL filters first (T4.3); this is the second check, run
 * on every profile or listing the API is about to return (docs/03 §13: "tested both ways").
 *
 * A women-only member's profile and listings are returned only to a viewer whose gender DigiLocker
 * verified as female. Self-declared gender never counts; an unverified viewer sees none of them
 * (FR-DISC-12). Who a women-only member sees is their flatmate gender preference (a hard filter,
 * FR-DISC-02), not this rule.
 */
import type { Category, VerifiedGender } from '@flatrimony/shared';

export interface Viewer {
  isIdentityVerified: boolean;
  /** Set only from a DigiLocker result. */
  verifiedGender: VerifiedGender | null;
}

export interface Subject {
  /** The category of the member the profile or listing belongs to. */
  category: Category;
}

/** DigiLocker says this person is a woman. */
export const isVerifiedWoman = (p: {
  isIdentityVerified: boolean;
  verifiedGender: VerifiedGender | null;
}) => p.isIdentityVerified && p.verifiedGender === 'female';

/** Whether `viewer` may see `subject`'s profile or listings. */
export function canSee(viewer: Viewer, subject: Subject): boolean {
  return subject.category !== 'women_only' || isVerifiedWoman(viewer);
}

/** Drops everything `viewer` may not see (the response filter). */
export function visibleTo<T extends Subject>(viewer: Viewer, subjects: readonly T[]): T[] {
  return subjects.filter((s) => canSee(viewer, s));
}
