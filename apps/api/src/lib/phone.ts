/** Indian mobile numbers (FR-AUTH-01): +91 followed by 10 digits starting 6–9, in E.164. */

/** Accepts E.164 with or without '+' (Supabase stores it without); returns '+91…' or null. */
export function normaliseIndianMobile(phone: string): string | null {
  const digits = phone.replace(/^\+/, '');
  return /^91[6-9]\d{9}$/.test(digits) ? `+${digits}` : null;
}
