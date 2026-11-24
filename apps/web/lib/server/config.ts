/**
 * Runtime configuration of the web server (docs/03 §5.1), read from the environment on each
 * request rather than baked into the bundle, so one image serves every environment. Only
 * `publicConfig` ever reaches the browser.
 */

/** Sent as X-App-Version (docs/05 §1); the Android app's first version is 0.1.0 too. */
export const WEB_APP_VERSION = '0.1.0';

export interface WebConfig {
  /** The Flatrimony API, for the browser (OTP guard) and the server (everything else). */
  apiUrl: string;
  supabaseUrl: string;
  /** Public by design (Supabase anon key); the browser uses it to request and verify OTPs. */
  supabaseAnonKey: string;
  /**
   * Shared with the API (its WEB_PROXY_SECRET): lets the API rate-limit by the user's IP rather
   * than this server's. Never sent to the browser.
   */
  proxySecret?: string;
  /** Proxies in front of this server whose X-Forwarded-For entries are trusted (Cloud Run: 1). */
  trustProxyHops: number;
  /** Secure cookies everywhere except plain-http local development (APP_ENV=local). */
  secureCookies: boolean;
}

/** What the browser needs: no secrets. */
export interface PublicConfig {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  appVersion: string;
}

export function webConfig(env: Record<string, string | undefined> = process.env): WebConfig {
  const hops = Number(env.TRUST_PROXY_HOPS ?? 0);
  const proxySecret = env.WEB_PROXY_SECRET || undefined; // empty means unset, as for the API
  if (proxySecret !== undefined && proxySecret.length < 32)
    throw new Error('WEB_PROXY_SECRET must be at least 32 characters');
  return {
    apiUrl: (env.API_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),
    supabaseUrl: (env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
    supabaseAnonKey: env.SUPABASE_ANON_KEY ?? '',
    ...(proxySecret ? { proxySecret } : {}),
    trustProxyHops: Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : 0,
    // Secure unless explicitly local (http://localhost); a missing APP_ENV is never "local".
    secureCookies: env.APP_ENV !== 'local',
  };
}

export function publicConfig(config: WebConfig): PublicConfig {
  return {
    apiUrl: config.apiUrl,
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    appVersion: WEB_APP_VERSION,
  };
}
