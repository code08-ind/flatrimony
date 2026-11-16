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
import { createIdentifierHasher, ephemeralPepper } from './lib/hashing.js';
import { memoryBansRepository, type BansRepository } from './modules/auth/bans.js';
import { createSendSmsGate, otpGuardRoutes } from './modules/auth/otp-guard.js';
import { memorySlidingWindowStore, type SlidingWindowStore } from './lib/sliding-window.js';
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
  /** Banned identities (Postgres in server.ts; in-memory default). */
  bansRepo?: BansRepository;
  /** OTP counters (sliding windows; in-memory default). */
  otpStore?: SlidingWindowStore;
  /** Capture logs (tests assert that no personal data is logged). */
  logStream?: { write(line: string): void };
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
  bansRepo,
  otpStore,
  logStream,
}: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: logStream ? 'debug' : env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      redact: REDACT,
      ...(logStream ? { stream: logStream } : {}),
    },
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
  const limiter = rateLimitStore ?? memoryRateLimitStore();
  await app.register(rateLimitPlugin, {
    store: limiter,
    ...(now ? { now } : {}),
  });
  await app.register(idempotencyPlugin, {
    store: idempotencyStore ?? memoryIdempotencyStore(IDEMPOTENCY_TTL_MS),
    ...(now ? { now } : {}),
  });

  const repo = systemRepo ?? inMemorySystemRepository();
  await app.register(healthRoutes, { repo });
  await app.register(v1SystemRoutes, { prefix: '/v1', repo });

  // OTP guard (T2.3). Identifiers are HMAC'd with HASH_PEPPER (required outside local; a throwaway
  // pepper locally, so local bans by hash do not survive a restart).
  const hasher = createIdentifierHasher(env.HASH_PEPPER ?? ephemeralPepper());
  const bans = bansRepo ?? memoryBansRepository();
  const otpCounters = otpStore ?? memorySlidingWindowStore();
  await app.register(otpGuardRoutes, {
    prefix: '/v1',
    hasher,
    bans,
    store: otpCounters,
    ...(now ? { now } : {}),
  });

  // Supabase Auth Send SMS hook (only when its secret is configured; required outside local).
  const sms = smsProvider ?? createSmsProvider(env.SMS_PROVIDER);
  if (env.SEND_SMS_HOOK_SECRETS) {
    const keys = parseWebhookSecrets(env.SEND_SMS_HOOK_SECRETS);
    await app.register(sendSmsHookRoutes, {
      keys,
      provider: sms,
      gate: createSendSmsGate({ hasher, bans, store: otpCounters, ...(now ? { now } : {}) }),
      ...(now ? { nowSeconds: () => Math.floor(now() / 1000) } : {}),
    });
  }
  if (env.APP_ENV === 'local' && env.NODE_ENV !== 'production' && isMockSmsProvider(sms)) {
    await app.register(devSmsOutboxRoutes, { provider: sms });
  }

  return app;
}
