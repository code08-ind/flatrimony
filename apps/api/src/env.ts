/**
 * Runtime configuration, validated at startup (docs/03 §5.1 rule 3): the process exits if a
 * required value is missing. Vendor secrets are optional until the matching module ships;
 * none are ever committed (see .env.example).
 */
import { z } from 'zod';
import { parseFieldKey } from './lib/field-crypto.js';
import { parseWebhookSecrets } from './lib/standard-webhooks.js';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

/** A bare browser origin (`https://app.example.com`, no path or trailing slash): what CORS compares. */
const isBareOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
};
const isLocalOrigin = (origin: string) => {
  const host = new URL(origin).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
};

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  /** Server-only key for Storage (profile photos, T2.10). Secret Manager outside local; never in clients. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_JWT_ISSUER: z.string().url().optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  /** Standard Webhooks secret(s) for the Supabase Auth Send SMS hook: `v1,whsec_<base64>`. */
  SEND_SMS_HOOK_SECRETS: z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      if (v === undefined) return;
      try {
        parseWebhookSecrets(v);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
      }
    }),
  /** AES-256-GCM key for encrypted fields (verified names; docs/04 §13): `v1:<base64 of 32 bytes>`. */
  FIELD_ENCRYPTION_KEY: z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      if (v === undefined) return;
      try {
        parseFieldKey(v);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
      }
    }),
  /**
   * DigiLocker identity provider (T3.1). Only `mock` exists until the founder picks a licensed
   * provider (T0.7, OQ-02); refused in production.
   */
  DIGILOCKER_PROVIDER: z.enum(['mock']).default('mock'),
  /** Standard Webhooks secret(s) the provider signs its webhooks with: `v1,whsec_<base64>`. */
  DIGILOCKER_WEBHOOK_SECRETS: z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      if (v === undefined) return;
      try {
        parseWebhookSecrets(v);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
      }
    }),
  /**
   * The API's public base URL, for links the API hands to clients (the mock DigiLocker consent
   * page). Required outside local; local default http://localhost:8080.
   */
  PUBLIC_API_URL: z.url().optional(),
  /**
   * Serve the mock DigiLocker consent page outside local development (staging testers). Anyone
   * can then verify as any identity, women-only included: only for environments with test data
   * and a single API instance (mock sessions live in memory). Default: only in local.
   */
  DIGILOCKER_MOCK_CONSENT_PAGE: z.enum(['true', 'false']).optional(),
  /** Pepper for HMAC lookup hashes of phones, devices, DigiLocker ids (docs/04 §13). Never rotate casually: bans and uniqueness depend on it. */
  HASH_PEPPER: z.string().min(32).optional(),
  /** OTP SMS provider. Only 'mock' exists until DLT registration (T0.6); refused in production. */
  SMS_PROVIDER: z.enum(['mock']).default('mock'),
  /**
   * Proxies in front of the API whose X-Forwarded-For entries are trusted. Default 0: nothing is
   * trusted, so a client cannot pick its own IP (QA T2.3 D3). Cloud Run sets 1 (its front end;
   * infra/terraform). With Cloudflare in front (ADR-0007) use CF-Connecting-IP and restrict ingress
   * instead of raising this, or the run.app URL becomes spoofable.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Shared with the web app's server, which calls the API for signed-in web users (docs/05 §2):
   * requests carrying it are rate-limited by the client IP the web server forwards. Unset: the
   * forwarded IP is ignored and all web users share the web server's per-IP limit.
   */
  WEB_PROXY_SECRET: z.string().min(32).optional(),
  /** Origins whose browser pages may call the API (docs/05 §1). Empty: no cross-origin calls. */
  CORS_ALLOWED_ORIGINS: csv.refine((origins) => origins.every(isBareOrigin), {
    message: 'each entry must be a bare origin such as https://app.example.com',
  }),
  /**
   * The routing service (apps/routing, Valhalla) for commute zone previews. Without it previews are
   * the radius approximation (`approx: true`).
   */
  ROUTING_URL: z.url().optional(),
  /**
   * Place search for the office/college picker (T2.8). `mock` searches the seeded NCR areas (local
   * and CI); `google` needs GOOGLE_PLACES_API_KEY and is required in production.
   */
  PLACES_PROVIDER: z.enum(['mock', 'google']).default('mock'),
  GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),
  APP_VERSION: z.string().default('0.0.0'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const env = parsed.data;
  if (
    env.APP_ENV === 'production' &&
    env.CORS_ALLOWED_ORIGINS.some((o) => o.startsWith('http:') || isLocalOrigin(o))
  ) {
    throw new Error('CORS_ALLOWED_ORIGINS must be https and not local in production');
  }
  if (env.PLACES_PROVIDER === 'google' && !env.GOOGLE_PLACES_API_KEY) {
    throw new Error('PLACES_PROVIDER=google needs GOOGLE_PLACES_API_KEY');
  }
  if (env.APP_ENV === 'production' && env.PLACES_PROVIDER === 'mock') {
    throw new Error('PLACES_PROVIDER=mock is not allowed in production');
  }
  if (env.APP_ENV === 'production' && env.DIGILOCKER_PROVIDER === 'mock') {
    throw new Error('DIGILOCKER_PROVIDER=mock is not allowed in production');
  }
  if (env.APP_ENV === 'production' && env.SMS_PROVIDER === 'mock') {
    throw new Error('SMS_PROVIDER=mock is not allowed in production');
  }
  if (env.APP_ENV !== 'local') {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required outside local development');
    if (!env.SUPABASE_JWT_ISSUER || !(env.SUPABASE_JWKS_URL || env.SUPABASE_JWT_SECRET)) {
      throw new Error(
        'SUPABASE_JWT_ISSUER and SUPABASE_JWKS_URL (or SUPABASE_JWT_SECRET) are required outside local development',
      );
    }
    if (!env.SEND_SMS_HOOK_SECRETS) {
      throw new Error('SEND_SMS_HOOK_SECRETS is required outside local development');
    }
    if (!env.HASH_PEPPER) throw new Error('HASH_PEPPER is required outside local development');
    if (!env.FIELD_ENCRYPTION_KEY)
      throw new Error('FIELD_ENCRYPTION_KEY is required outside local development');
    if (!env.PUBLIC_API_URL)
      throw new Error('PUBLIC_API_URL is required outside local development');
    if (!env.DIGILOCKER_WEBHOOK_SECRETS)
      throw new Error('DIGILOCKER_WEBHOOK_SECRETS is required outside local development');
    // Profile photos (T2.10): without Storage the photo routes answer 503 and nobody can finish
    // their profile, so a deploy without it is a misconfiguration.
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required outside local development',
      );
  }
  return env;
}
