import type { Metadata } from 'next';
import Link from 'next/link';
import { isLocale, t, type Locale } from '@flatrimony/i18n';
import '../app/legal.css';

/** The four legal pages (W07–W10), by URL slug. */
export const LEGAL_PAGES = [
  'terms',
  'privacy',
  'community-standards',
  'tenancy-guidelines',
] as const;
export type LegalPageId = (typeof LEGAL_PAGES)[number];

const title = (page: LegalPageId, locale: Locale) => t(locale, `web.legalPage.titles.${page}`);

export function legalMetadata(page: LegalPageId) {
  return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params;
    if (!isLocale(locale)) return {};
    return {
      title: `${title(page, locale)} · ${t(locale, 'app.name')}`,
      alternates: { languages: { en: `/en/${page}`, hi: `/hi/${page}` } },
    };
  };
}

/**
 * Terms (W07), Privacy (W08), Community Standards (W09) and Tenancy Guidelines (W10) until their
 * text has passed legal review (founder task T0.15). The design's drafts invent business details
 * and claims (statistics, certifications, prices, support hours) and contradict the product in
 * places, so only the title, a "being prepared" note and the 112 note are shown. The drafts are
 * kept unpublished in content/legal/ (scripts/extract-legal.py) for after the review. Sign-up stays
 * closed until the policy versions are published (the API refuses bootstrap without them).
 */
export function LegalPage({ page, locale }: { page: LegalPageId; locale: Locale }) {
  const other: Locale = locale === 'en' ? 'hi' : 'en';
  return (
    <main className="legal">
      <div className="legal-top">
        <nav className="legal-crumbs" aria-label={t(locale, 'web.legalPage.breadcrumb')}>
          <ol>
            <li>
              <Link href={`/${locale}`}>{t(locale, 'web.legalPage.home')}</Link>
            </li>
            <li>{t(locale, 'web.legalPage.legal')}</li>
            <li aria-current="page">{title(page, locale)}</li>
          </ol>
        </nav>
        <Link className="legal-lang" href={`/${other}/${page}`} hrefLang={other} lang={other}>
          {t(locale, 'web.legalPage.otherLanguage')}
        </Link>
      </div>
      <h1>{title(page, locale)}</h1>
      <p className="legal-note" role="note">
        {t(locale, 'web.legalPage.preparing')}
      </p>
      <aside className="legal-emergency" aria-label={t(locale, 'web.legalPage.emergencyTitle')}>
        <p className="legal-emergency-title">{t(locale, 'web.legalPage.emergencyTitle')}</p>
        <p>{t(locale, 'web.legalPage.emergency', { number: '112' })}</p>
      </aside>
    </main>
  );
}
