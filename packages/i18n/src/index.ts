import { IntlMessageFormat } from 'intl-messageformat';
import en from './messages/en.json' with { type: 'json' };
import hi from './messages/hi.json' with { type: 'json' };
import type { Locale } from './format.js';

export * from './format.js';
export { ensurePluralRules } from './plural-rules.js';

export type Messages = typeof en;
export const messages: Record<Locale, Messages> = { en, hi };
export const locales: readonly Locale[] = ['en', 'hi'] as const;
export const defaultLocale: Locale = 'en';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every message key, e.g. `glossary.rishtaPakka`. */
export type MessageKey = Leaves<Messages>;

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'hi';
}

export function getMessage(locale: Locale, key: MessageKey): string {
  let node: unknown = messages[locale];
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node !== 'string') throw new Error(`Missing message ${locale}:${key}`);
  return node;
}

/** Formats an ICU message. Apps use i18next / next-intl with the same JSON; this is for shared code and tests. */
export function t(
  locale: Locale,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  return String(new IntlMessageFormat(getMessage(locale, key), locale).format(values));
}
