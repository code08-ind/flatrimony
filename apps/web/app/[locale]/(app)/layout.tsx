import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { isLocale } from '@flatrimony/i18n';
import { AppProvider } from '../../../lib/client/app-context';
import { publicConfig, webConfig } from '../../../lib/server/config';
import '../../ui.css';

/**
 * Signed-in and sign-in pages: rendered per request (they read the session cookie and the runtime
 * config), with the public part of the config and the language handed to client components.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AppProvider config={publicConfig(webConfig())} locale={locale}>
      {children}
    </AppProvider>
  );
}
