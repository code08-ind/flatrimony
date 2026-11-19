import type { MessageKey } from '@flatrimony/i18n';

/** Message for a failed onboarding save (docs/05 §13 codes). */
export function saveErrorKey(
  status: number | 'network',
  code?: string,
  /** errors[].code values of a 422 validation.failed */
  fieldCodes: string[] = [],
): MessageKey {
  if (status === 'network') return 'onboarding.errors.save';
  if (fieldCodes.includes('in_the_past')) return 'onboarding.errors.windowOver';
  if (code === 'profile.category_not_allowed') return 'onboarding.errors.categoryNotAllowed';
  if (code === 'auth.banned') return 'auth.errors.banned';
  if (code === 'profile.underage') return 'onboarding.errors.underage';
  if (status === 503) return 'onboarding.errors.notOpen';
  if (status === 429) return 'auth.errors.tooManyRequests';
  return 'onboarding.errors.generic';
}
