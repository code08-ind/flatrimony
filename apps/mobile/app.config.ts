import type { ExpoConfig } from 'expo/config';

/**
 * Env-driven Expo config (docs/03 §3). Only public values reach the bundle (docs/03 §5.1):
 * API base URL, Supabase anon key, Sentry DSN, PostHog key. Never put secrets here.
 *
 * Founder decisions still open:
 *  - Android package id depends on name clearance (T0.3); `in.flatrimony.app` is a placeholder.
 *  - EAS project id appears once the Expo account exists (Blocked, see docs/07 T1.12).
 */
const APP_ENV = process.env.APP_ENV ?? 'local';

const config: ExpoConfig = {
  name: APP_ENV === 'production' ? 'Flatrimony' : `Flatrimony (${APP_ENV})`,
  slug: 'flatrimony',
  scheme: 'flatrimony',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  // 'web' is ONLY the local design-preview target for QA in a browser (there is no Android SDK on
  // the dev machine yet); the product web app is apps/web (Next.js).
  platforms: ['android', 'web'],
  android: {
    package: APP_ENV === 'production' ? 'in.flatrimony.app' : `in.flatrimony.app.${APP_ENV}`,
  },
  runtimeVersion: { policy: 'fingerprint' },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-localization',
    'expo-secure-store',
    // Photos come from the system photo picker (no storage permission on Android 13+); the camera
    // is not used (T2.11).
    ['expo-image-picker', { cameraPermission: false, microphonePermission: false }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    appEnv: APP_ENV,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080',
    webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '',
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
};

export default config;
