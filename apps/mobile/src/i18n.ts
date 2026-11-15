import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { messages } from '@flatrimony/i18n';
import { pickLocale } from './locale';

/** i18next over the shared ICU-compatible JSON (docs/03 §2.1). Language switch applies without restart. */
export function initI18n() {
  if (i18next.isInitialized) return i18next;
  void i18next.use(initReactI18next).init({
    resources: { en: { translation: messages.en }, hi: { translation: messages.hi } },
    lng: pickLocale(getLocales().map((l) => l.languageTag)),
    fallbackLng: 'en',
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    returnNull: false,
  });
  return i18next;
}
