import type { Metadata } from 'next';
import { isLocale, t, type MessageKey } from '@flatrimony/i18n';

/** A page's <title>: "<what this page is> · Flatrimony" in the page's language (WCAG 2.4.2). */
export function titled(key: MessageKey) {
  return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params;
    return isLocale(locale) ? { title: `${t(locale, key)} · ${t(locale, 'app.name')}` } : {};
  };
}
