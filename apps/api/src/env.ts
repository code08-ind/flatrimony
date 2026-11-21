/**
 * Runtime configuration, validated at startup (docs/03 §5.1 rule 3): the process exits if a
 * required value is missing. Vendor secrets are optional until the matching module ships;
 * none are ever committed (see .env.example).
 */
import { z } from 'zod';
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
  /** Origins whose browser pages may call the API (docs/05 §1). Empty: no cross-origin calls. */
  CORS_ALLOWED_ORIGINS: csv.refine((origins) => origins.every(isBareOrigin), {
    message: 'each entry must be a bare origin such as https://app.example.com',
  }),
  /**
   * The routing service (apps/routing, Valhalla) for commute zone previews. Without it previews are
   * the radius approximation (`approx: true`).
   */
  ROUTING_URL: z.url().optional(),
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
    // Profile photos (T2.10): without Storage the photo routes answer 503 and nobody can finish
    // their profile, so a deploy without it is a misconfiguration.
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required outside local development',
      );
  }
  return env;
}
