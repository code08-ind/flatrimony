'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { getMessage, t as format, type Locale, type MessageKey } from '@flatrimony/i18n';
import type { PublicConfig } from '../server/config';

interface AppContextValue {
  config: PublicConfig;
  locale: Locale;
}

const AppContext = createContext<AppContextValue | null>(null);

/** The runtime config and the page's language, for client components (set by the (app) layout). */
export function AppProvider({
  config,
  locale,
  children,
}: AppContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ config, locale }), [config, locale]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppProvider is missing');
  return value;
}

export const useConfig = () => useApp().config;

/** True when Supabase Auth is configured (it is not in CI builds without the local stack). */
export const authConfigured = (c: PublicConfig) => c.supabaseUrl !== '' && c.supabaseAnonKey !== '';

/** Translations for the page's language; `raw` returns the message unformatted (rich text). */
export function useT() {
  const { locale } = useApp();
  const t = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) => format(locale, key, values),
    [locale],
  );
  const raw = useCallback((key: MessageKey) => getMessage(locale, key), [locale]);
  return { t, raw, locale };
}
