/**
 * Runtime configuration, validated at startup (docs/03 §5.1 rule 3): the process exits if a
 * required value is missing. Vendor secrets are optional until the matching module ships;
 * none are ever committed (see .env.example).
 */
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_ISSUER: z.string().url().optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  CORS_ALLOWED_ORIGINS: csv,
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
  if (env.APP_ENV !== 'local') {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required outside local development');
    if (!env.SUPABASE_JWT_ISSUER || !(env.SUPABASE_JWKS_URL || env.SUPABASE_JWT_SECRET)) {
      throw new Error(
        'SUPABASE_JWT_ISSUER and SUPABASE_JWKS_URL (or SUPABASE_JWT_SECRET) are required outside local development',
      );
    }
  }
  return env;
}
