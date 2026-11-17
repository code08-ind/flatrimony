import { Platform } from 'react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { messages } from '@flatrimony/i18n';
import { isLocale, type Locale } from '@flatrimony/i18n';
import { pickLocale } from './locale';
import { storage } from './storage';

const LOCALE_KEY = 'flatrimony.locale';

/** The user's explicit language choice (FR-AUTH-05), applied at once and remembered. */
export async function setAppLocale(locale: Locale): Promise<void> {
  await applyLocale(locale);
  await storage.setItem(LOCALE_KEY, locale);
}

/** Restores a saved choice; returns whether one existed (first launch shows the language picker). */
export async function restoreAppLocale(): Promise<boolean> {
  const saved = await storage.getItem(LOCALE_KEY);
  if (isLocale(saved)) {
    await applyLocale(saved);
    return true;
  }
  return false;
}

async function applyLocale(locale: Locale) {
  await i18next.changeLanguage(locale);
  // Web preview: screen readers pick the voice from <html lang>.
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

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
