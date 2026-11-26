import Constants from 'expo-constants';

/** Public, bundle-safe configuration from app.config.ts `extra` (docs/03 §5.1). */
export interface AppConfig {
  appEnv: string;
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  appVersion: string;
  webUrl: string;
  /** Google Cloud project number for Play Integrity (public; empty until the Play Console exists). */
  playIntegrityCloudProject: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppConfig>;

export const config: AppConfig = {
  appEnv: extra.appEnv ?? 'local',
  apiUrl: extra.apiUrl ?? 'http://localhost:8080',
  supabaseUrl: extra.supabaseUrl ?? '',
  supabaseAnonKey: extra.supabaseAnonKey ?? '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  webUrl: extra.webUrl ?? 'http://localhost:3000',
  playIntegrityCloudProject: extra.playIntegrityCloudProject ?? '',
};

/** Legal pages live on the web app (drafts pending legal review, T0.15). */
export const legalUrl = (page: 'terms' | 'privacy', locale: 'en' | 'hi') =>
  `${config.webUrl}/${locale}/${page}`;

/** True when the Supabase project is configured (empty in CI and before the founder's accounts). */
export const authConfigured = config.supabaseUrl !== '' && config.supabaseAnonKey !== '';
