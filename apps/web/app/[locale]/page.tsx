import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isLocale, t } from '@flatrimony/i18n';

// Placeholder home for the M1 pipeline ("hello" page, docs/03 §19).
// Real screens follow docs/designs/web (W01–W10).
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <main className="shell">
      <p className="wordmark">{t(locale, 'app.name')}</p>
      <h1 className="tagline">{t(locale, 'app.tagline')}</h1>
      <p className="lead">{t(locale, 'app.notDating')}</p>
      <p className="muted">{t(locale, 'app.promise')}</p>
      <nav className="langs" aria-label={t(locale, 'language.choose')}>
        <Link
          className="pill primary"
          href="/en"
          hrefLang="en"
          aria-current={locale === 'en' ? 'page' : undefined}
        >
          {t(locale, 'language.continueEnglish')}
        </Link>
        <Link
          className="pill secondary"
          href="/hi"
          hrefLang="hi"
          aria-current={locale === 'hi' ? 'page' : undefined}
        >
          {t(locale, 'language.continueHindi')}
        </Link>
      </nav>
    </main>
  );
}
