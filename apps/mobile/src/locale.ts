import { defaultLocale, type Locale } from '@flatrimony/i18n';

/** Picks the app language from device language tags (BCP 47). Hindi if the device prefers it, else English. */
export function pickLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const tag of tags) {
    const lang = tag?.toLowerCase().split(/[-_]/)[0];
    if (lang === 'hi') return 'hi';
    if (lang === 'en') return 'en';
  }
  return defaultLocale;
}
