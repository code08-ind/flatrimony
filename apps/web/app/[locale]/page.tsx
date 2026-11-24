import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isLocale, t } from '@flatrimony/i18n';

// Placeholder home (docs/03 §19) with the way in to sign-in; the real landing page is W01.
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <main className="shell">
      <p className="wordmark">{t(locale, 'app.name')}</p>
      <h1 className="tagline">{t(locale, 'app.tagline')}</h1>
      <p className="lead">{t(locale, 'app.notDating')}</p>
      <p className="muted">{t(locale, 'app.promise')}</p>
      <p>
        <Link className="pill primary" href={`/${locale}/sign-in`} data-testid="get-started">
          {t(locale, 'web.getStarted')}
        </Link>
      </p>
      <nav className="langs" aria-label={t(locale, 'language.choose')}>
        <Link
          className="pill secondary"
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
