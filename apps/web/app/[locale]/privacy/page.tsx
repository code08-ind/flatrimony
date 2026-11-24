import { notFound } from 'next/navigation';
import { isLocale } from '@flatrimony/i18n';
import { LegalPage, legalMetadata } from '../../../components/LegalPage';

export const generateMetadata = legalMetadata('privacy');

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <LegalPage page="privacy" locale={locale} />;
}
