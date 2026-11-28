/**
 * A minimal `Intl.PluralRules` for engines without it. Hermes, the Android app's JavaScript engine,
 * has no `Intl.PluralRules`, and every plural message ("3 photos", "expires in 7 days") is
 * formatted with it (intl-messageformat), so the app crashed on the first screen with one (T3.11).
 *
 * Only what the app's messages use: cardinal rules ("one" / "other") for English and Hindi, from
 * CLDR. English: one when the number is exactly 1 (1.0 counts, 1.5 does not). Hindi: one for 0 to
 * 1 inclusive (i = 0 or n = 1). Other locales use the English rule; ordinal rules are not needed
 * (no message uses `selectordinal`) and answer "other". A full polyfill
 * (@formatjs/intl-pluralrules) needs `Intl.Locale`, which Hermes lacks too.
 */
type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

function cardinal(language: string, n: number): PluralCategory {
  if (!Number.isFinite(n)) return 'other';
  const abs = Math.abs(n);
  if (language === 'hi') return abs <= 1 ? 'one' : 'other';
  return abs === 1 ? 'one' : 'other';
}

class MinimalPluralRules {
  readonly #language: string;
  readonly #type: 'cardinal' | 'ordinal';
  readonly #locale: string;

  constructor(locales?: string | readonly string[], options?: { type?: 'cardinal' | 'ordinal' }) {
    const first = (Array.isArray(locales) ? locales[0] : locales) as string | undefined;
    this.#locale = first ?? 'en';
    this.#language = this.#locale.split('-')[0]!.toLowerCase();
    this.#type = options?.type ?? 'cardinal';
  }

  select(n: number): PluralCategory {
    return this.#type === 'ordinal' ? 'other' : cardinal(this.#language, Number(n));
  }

  resolvedOptions() {
    return {
      locale: this.#locale,
      type: this.#type,
      pluralCategories: ['one', 'other'],
    };
  }

  static supportedLocalesOf(locales?: string | readonly string[]): string[] {
    return (Array.isArray(locales) ? [...locales] : locales ? [locales as string] : []).filter(
      (l) => /^(en|hi)(-|$)/i.test(l),
    );
  }
}

/** Installs the minimal rules when the engine has no `Intl.PluralRules`. Returns whether it did. */
export function ensurePluralRules(target: { Intl?: typeof Intl } = globalThis): boolean {
  const intl = (target.Intl ??= {} as typeof Intl) as { PluralRules?: unknown };
  if (typeof intl.PluralRules === 'function') return false;
  intl.PluralRules = MinimalPluralRules;
  return true;
}

export { MinimalPluralRules as _MinimalPluralRules };
