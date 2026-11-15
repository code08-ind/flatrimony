/**
 * Formatting rules from docs/02 §12 and docs/06 §11.2:
 * Indian digit grouping (₹1,50,000), "12 Nov" / "12 Nov 2026", "11:00 PM", IST for display.
 * Western digits (0–9) in both languages.
 */
export type Locale = 'en' | 'hi';

export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

const intlLocale = (locale: Locale) => (locale === 'hi' ? 'hi-IN-u-nu-latn' : 'en-IN');

const inrFormatters = new Map<Locale, Intl.NumberFormat>();

/** `₹21,500`, `₹1,50,000`. Whole rupees only (listing prices are integer rupees). */
export function formatINR(amountInr: number, locale: Locale = 'en'): string {
  if (!Number.isFinite(amountInr)) throw new RangeError('amountInr must be a finite number');
  let fmt = inrFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
    inrFormatters.set(locale, fmt);
  }
  return fmt.format(amountInr);
}

/** Paise (bigint-safe integer) to a rupee string with two decimals when needed: `₹499`, `₹499.50`. */
export function formatPaise(amountPaise: number, locale: Locale = 'en'): string {
  if (!Number.isInteger(amountPaise)) throw new RangeError('amountPaise must be an integer');
  const fmt = new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: amountPaise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return fmt.format(amountPaise / 100);
}

function istYear(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-IN', { timeZone: DISPLAY_TIME_ZONE, year: 'numeric' }).format(date),
  );
}

/** "12 Nov" when in the same (IST) year as `now`, otherwise "12 Nov 2026". */
export function formatDate(date: Date | string, locale: Locale = 'en', now: Date = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid date');
  const sameYear = istYear(d) === istYear(now);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: DISPLAY_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

/** "11:00 PM" in IST, 12-hour clock. */
export function formatTime(date: Date | string, locale: Locale = 'en'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid date');
  const out = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN-u-nu-latn' : 'en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return locale === 'en' ? out.toUpperCase() : out;
}

/** "HH:mm" time of day (as stored, 24 h) to "11:00 PM" — no timezone conversion. */
export function formatTimeOfDay(hhmm: string, locale: Locale = 'en'): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new RangeError(`Expected HH:mm, got ${hhmm}`);
  const d = new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])));
  const out = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN-u-nu-latn' : 'en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return locale === 'en' ? out.toUpperCase() : out;
}
