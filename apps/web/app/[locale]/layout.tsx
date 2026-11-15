import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Noto_Sans_Devanagari, Plus_Jakarta_Sans } from 'next/font/google';
import { isLocale, locales, t } from '@flatrimony/i18n';
import '@flatrimony/design-tokens/tokens.css';
import '../globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-latin',
  display: 'swap',
});
const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-devanagari',
  display: 'swap',
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: `${t(locale, 'app.name')} — ${t(locale, 'app.tagline')}`,
    description: t(locale, 'app.notDating'),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} className={`${jakarta.variable} ${devanagari.variable}`}>
      <body data-locale={locale}>{children}</body>
    </html>
  );
}
