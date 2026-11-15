import { redirect } from 'next/navigation';
import { defaultLocale } from '@flatrimony/i18n';

export default function Index() {
  redirect(`/${defaultLocale}`);
}
