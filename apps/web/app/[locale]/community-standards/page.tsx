import { notFound } from 'next/navigation';
import { isLocale } from '@flatrimony/i18n';
import { LegalPage, legalMetadata } from '../../../components/LegalPage';

export const generateMetadata = legalMetadata('community-standards');

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <LegalPage page="community-standards" locale={locale} />;
}
