// First: Intl gaps on Android (Hermes has no Intl.PluralRules), before anything formats text.
import '../src/intl';
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_500Medium,
  NotoSansDevanagari_600SemiBold,
  NotoSansDevanagari_700Bold,
} from '@expo-google-fonts/noto-sans-devanagari';
import { initI18n, restoreAppLocale } from '../src/i18n';
import { SessionProvider } from '../src/auth/session';
import { MeProvider } from '../src/me';
import { theme } from '../src/theme';

initI18n();
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_500Medium,
    NotoSansDevanagari_600SemiBold,
    NotoSansDevanagari_700Bold,
  });

  // Restore the user's language choice (FR-AUTH-05) before the first screen renders.
  const [localeReady, setLocaleReady] = useState(false);
  useEffect(() => {
    void restoreAppLocale()
      .catch(() => false)
      .finally(() => setLocaleReady(true));
  }, []);

  const ready = (loaded || !!error) && localeReady;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SessionProvider>
      <MeProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.color.bg.app },
          }}
        />
      </MeProvider>
    </SessionProvider>
  );
}
