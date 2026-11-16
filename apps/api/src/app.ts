import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { HEADERS, IDEMPOTENCY_TTL_MS } from '@flatrimony/shared';
import type { Env } from './env.js';
import { authPlugin, createJwtVerifier, type JwtVerifier } from './plugins/auth.js';
import { errorsPlugin } from './plugins/errors.js';
import { idempotencyPlugin } from './plugins/idempotency.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import {
  memoryIdempotencyStore,
  memoryRateLimitStore,
  type IdempotencyStore,
  type RateLimitStore,
} from './lib/stores.js';
import { genReqId } from './plugins/request-id.js';
import { healthRoutes, v1SystemRoutes } from './modules/system/routes.js';
import { devSmsOutboxRoutes, sendSmsHookRoutes } from './modules/auth-hooks/routes.js';
import { createSmsProvider, isMockSmsProvider, type SmsProvider } from './lib/sms.js';
import { parseWebhookSecrets } from './lib/standard-webhooks.js';
import { inMemorySystemRepository, type SystemRepository } from './modules/system/repository.js';

export interface BuildOptions {
  env: Env;
  systemRepo?: SystemRepository;
  /** Overrides the verifier built from env (tests). */
  jwtVerifier?: JwtVerifier;
  rateLimitStore?: RateLimitStore;
  idempotencyStore?: IdempotencyStore;
  now?: () => number;
  /** OTP SMS provider (defaults to the one named by SMS_PROVIDER; tests inject their own). */
  smsProvider?: SmsProvider;
}

/** Builds the JWT verifier from env; undefined when auth is not configured (local only). */
export function verifierFromEnv(env: Env): JwtVerifier | undefined {
  if (!env.SUPABASE_JWT_ISSUER || !(env.SUPABASE_JWKS_URL || env.SUPABASE_JWT_SECRET))
    return undefined;
  return createJwtVerifier({
    issuer: env.SUPABASE_JWT_ISSUER,
    ...(env.SUPABASE_JWKS_URL ? { jwksUrl: env.SUPABASE_JWKS_URL } : {}),
    ...(env.SUPABASE_JWT_SECRET ? { secret: env.SUPABASE_JWT_SECRET } : {}),
  });
}

/** Never log PII (docs/03 §13.1): headers that may carry tokens or phone numbers are redacted. */
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'body.phone',
  'body.otp',
  'body.token',
];

export async function buildApp({
  env,
  systemRepo,
  jwtVerifier,
  rateLimitStore,
  idempotencyStore,
  now,
  smsProvider,
}: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL, redact: REDACT },
    genReqId,
    requestIdHeader: false,
    bodyLimit: 100 * 1024, // docs/03 §14: body ≤ 100 KB
    // Trust exactly TRUST_PROXY_HOPS proxies (hop 0 = the nearest), never the client-supplied rest.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header(HEADERS.requestId, req.id);
    reply.header('x-content-type-options', 'nosniff');
  });

  await app.register(errorsPlugin);
  const verifier = jwtVerifier ?? verifierFromEnv(env);
  await app.register(authPlugin, verifier ? { verifier } : {});
  await app.register(rateLimitPlugin, {
    store: rateLimitStore ?? memoryRateLimitStore(),
    ...(now ? { now } : {}),
  });
  await app.register(idempotencyPlugin, {
    store: idempotencyStore ?? memoryIdempotencyStore(IDEMPOTENCY_TTL_MS),
    ...(now ? { now } : {}),
  });

  const repo = systemRepo ?? inMemorySystemRepository();
  await app.register(healthRoutes, { repo });
  await app.register(v1SystemRoutes, { prefix: '/v1', repo });

  // Supabase Auth Send SMS hook (only when its secret is configured; required outside local).
  const sms = smsProvider ?? createSmsProvider(env.SMS_PROVIDER);
  if (env.SEND_SMS_HOOK_SECRETS) {
    const keys = parseWebhookSecrets(env.SEND_SMS_HOOK_SECRETS);
    await app.register(sendSmsHookRoutes, {
      keys,
      provider: sms,
      ...(now ? { nowSeconds: () => Math.floor(now() / 1000) } : {}),
    });
  }
  if (env.APP_ENV === 'local' && env.NODE_ENV !== 'production' && isMockSmsProvider(sms)) {
    await app.register(devSmsOutboxRoutes, { provider: sms });
  }

  return app;
}
