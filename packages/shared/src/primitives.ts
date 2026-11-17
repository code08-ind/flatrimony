/** Wire-format primitives (docs/05 §1). */
import { z } from 'zod';
import { LIMITS } from './constants.js';

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: false });
export const IsoDate = z.iso.date();
/** "HH:mm", 24 h. */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm (24 h)');

export const LatLng = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export type LatLng = z.infer<typeof LatLng>;

/** Indian mobile number in E.164: +91 followed by 10 digits starting 6–9. */
export const IndianPhone = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Expected an Indian mobile number (+91XXXXXXXXXX)');

/** Listing prices: whole rupees (docs/04 §1.6). */
export const Inr = z.number().int().nonnegative();
/** Payments and bills: integer paise. */
export const Paise = z.number().int().nonnegative();

// Control, soft-hyphen, zero-width and bidirectional-override characters (invisible or spoofing).
// Mirrors public.is_human_text() in supabase/migrations/*_profiles_and_biodata.sql.
// Also characters that render as blank (Hangul fillers, Braille blank, Mongolian vowel separator,
// combining grapheme joiner, Khmer invisible vowels; QA T2.5 D2).
const INVISIBLE =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u001F\u007F-\u009F\u00AD\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2800\u3164\uFEFF\uFFA0]|\u034F|\u17B4|\u17B5/u;

/** A UTF-16 surrogate without its pair: not a character (stored as U+FFFD by Postgres). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const isWellFormedText = (s: string) => !LONE_SURROGATE.test(s);

/**
 * Text people will read (names, labels): trimmed, 1..max characters counted in code points like
 * Postgres `char_length`, at least one visible character, no invisible or bidi-control characters.
 */
export function humanText(max: number) {
  return z
    .string()
    .trim()
    .refine((s) => {
      const length = [...s].length;
      return length >= 1 && length <= max;
    }, `Must be 1 to ${max} characters`)
    .refine(
      (s) => !INVISIBLE.test(s) && /\S/u.test(s) && isWellFormedText(s),
      'Must contain only visible characters',
    );
}

/** ISO 639-1 language code, e.g. 'hi', 'en'. */
export const LanguageCode = z.string().regex(/^[a-z]{2}$/, 'Expected an ISO 639-1 code');

export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected MAJOR.MINOR.PATCH');

/** Cursor pagination query (docs/05 §5). */
export function cursorQuery(maxLimit: number = LIMITS.page.maxLimit) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(LIMITS.page.defaultLimit),
    cursor: z.string().min(1).optional(),
  });
}

/** `{ data: T[], page: { nextCursor, hasMore } }` */
export function paged<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.object({ nextCursor: z.string().optional(), hasMore: z.boolean() }),
  });
}

/** Opaque cursor helpers: base64url of `{ sortKey, id }`. Clients never build cursors. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Works in Node, browsers and Hermes (no Buffer). */
export function encodeCursor(sortKey: string | number, id: string): string {
  return toBase64Url(JSON.stringify({ sortKey, id }));
}

const CursorPayload = z.object({ sortKey: z.union([z.string(), z.number()]), id: z.string() });

export function decodeCursor(cursor: string): z.infer<typeof CursorPayload> | null {
  try {
    return CursorPayload.parse(JSON.parse(fromBase64Url(cursor)));
  } catch {
    return null;
  }
}
