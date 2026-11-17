import { useTranslation } from 'react-i18next';
import { getMessage, t as format, type Locale, type MessageKey } from '@flatrimony/i18n';

/**
 * Translations through the shared ICU formatter (packages/i18n), so mobile and web render the same
 * messages. i18next only tracks the current language and re-renders on change.
 */
export function useT() {
  const { i18n } = useTranslation();
  const locale: Locale = i18n.language === 'hi' ? 'hi' : 'en';
  return {
    locale,
    t: (key: MessageKey, values?: Record<string, string | number>) => format(locale, key, values),
    /** The untouched message, for strings with rich-text tags (rendered by parseRich). */
    raw: (key: MessageKey) => getMessage(locale, key),
  };
}
