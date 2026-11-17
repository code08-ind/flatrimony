/** Phone entry for Indian mobiles (FR-AUTH-01; docs/06 §8.2): fixed +91, 10 digits starting 6–9. */

export const NATIONAL_LENGTH = 10;

/** Keeps ASCII digits only and caps at 10 (paste-safe: "+91 98123-45678" → "9812345678"). */
export function sanitiseNational(input: string): string {
  let digits = input.replace(/\D/g, '');
  // A pasted full number: drop a leading 91 or 0 when it leaves exactly 10 digits.
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, NATIONAL_LENGTH);
}

/** Applies one keypad key ('0'–'9' or 'backspace') to the national number. */
export function applyKey(current: string, key: string): string {
  if (key === 'backspace') return current.slice(0, -1);
  if (/^\d$/.test(key) && current.length < NATIONAL_LENGTH) return current + key;
  return current;
}

/** "9812345678" → "98123 45678" (as typed: partial numbers format progressively). */
export function formatNational(digits: string): string {
  return digits.length <= 5 ? digits : `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** False as soon as the first digit cannot start an Indian mobile number (0–5), for early feedback. */
export function hasValidStart(digits: string): boolean {
  return digits.length === 0 || /^[6-9]/.test(digits);
}

export function isValidMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

export function toE164(digits: string): string {
  if (!isValidMobile(digits)) throw new Error('Not a valid Indian mobile number');
  return `+91${digits}`;
}

/** "+919812345678" → "+91 98123 45678" for display. */
export function displayE164(e164: string): string {
  const national = e164.replace(/^\+91/, '');
  return `+91 ${formatNational(national)}`;
}
