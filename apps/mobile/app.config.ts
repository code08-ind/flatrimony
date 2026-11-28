import type { ExpoConfig } from 'expo/config';
import { withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Env-driven Expo config (docs/03 §3). Only public values reach the bundle (docs/03 §5.1):
 * API base URL, Supabase anon key, Sentry DSN, PostHog key. Never put secrets here.
 *
 * Founder decisions still open:
 *  - Android package id depends on name clearance (T0.3); `in.flatrimony.app` is a placeholder.
 *  - EAS project id appears once the Expo account exists (Blocked, see docs/07 T1.12).
 */
const APP_ENV = process.env.APP_ENV ?? 'local';

/**
 * Local builds only (the Android E2E run, docs/03 §8.1): the app talks to the local stack over
 * plain HTTP (the emulator reaches the host at 10.0.2.2), which Android blocks by default in release
 * builds. Staging and production builds never get this.
 */
const withLocalCleartext: ConfigPlugin = (cfg) =>
  withAndroidManifest(cfg, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });

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
    // Photos come from the system photo picker (no storage permission on Android 13+); the picker
    // never opens the camera (T2.11). Its `cameraPermission` stays unset: `false` would block
    // android.permission.CAMERA for the whole app, and the walkthrough recorder needs it (T3.11).
    ['expo-image-picker', { microphonePermission: false }],
    // The listing walkthrough is recorded in the app (T3.7; FR-LST-05), without sound: camera
    // permission only, no microphone.
    [
      'expo-camera',
      {
        cameraPermission:
          'Flatrimony uses the camera to record the walkthrough video of your flat.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    'expo-video',
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
    // Play Integrity standard requests (T3.6/T3.7); empty until the Play Console project exists.
    playIntegrityCloudProject: process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT ?? '',
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
};

// Only when APP_ENV=local is set explicitly (the E2E build does): a build that forgot APP_ENV never
// allows plain HTTP. Debug builds allow it anyway for Metro.
export default process.env.APP_ENV === 'local' ? withLocalCleartext(config) : config;
