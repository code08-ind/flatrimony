import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
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
import { meRoutes } from './modules/me/routes.js';
import type { MeRepository } from './modules/me/repository.js';
import type { PhotoStorage } from './lib/photo-storage.js';
import { googleIdToken } from '@flatrimony/routing';
import { createCommutePreview, type CommutePreview } from './lib/commute-preview.js';

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
  /** Profiles and consents (Postgres in server.ts). Without it the /v1/me routes are not served. */
  meRepo?: MeRepository;
  /** Profile photo storage (Supabase Storage in server.ts; tests inject a memory store). */
  photoStorage?: PhotoStorage;
  /** Commute zone previews (default: from ROUTING_URL, radius approximation without it). */
  commutePreview?: CommutePreview;
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
  'body.device.deviceId',
  'body.device.pushToken',
  'body.device.integrityToken',
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
  meRepo,
  photoStorage,
  commutePreview,
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
  // Browsers may call the API only from listed origins (web app, admin, local previews). Native apps
  // send no Origin and are unaffected. No credentials: tokens travel in the Authorization header.
  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS.length > 0 ? env.CORS_ALLOWED_ORIGINS : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'if-match',
      'x-app-platform',
      'x-app-version',
      'x-request-id',
    ],
    exposedHeaders: [
      'retry-after',
      'x-request-id',
      'etag',
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
      'idempotent-replayed',
      'location',
    ],
    maxAge: 600,
  });
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

  // Account and consents (T2.5). Needs Postgres: the rules live in database constraints.
  if (meRepo) {
    await app.register(meRoutes, {
      prefix: '/v1',
      repo: meRepo,
      ...(photoStorage ? { photos: photoStorage } : {}),
      commutePreview:
        commutePreview ??
        createCommutePreview({
          routingUrl: env.ROUTING_URL,
          // The routing service is private on Cloud Run: call it with a Google ID token.
          ...(env.APP_ENV === 'local'
            ? {}
            : { token: (audience: string) => googleIdToken(audience) }),
          onRoutingError: (err) =>
            app.log.warn(
              { err: err.name, retryable: err.retryable },
              'routing failed; approximating',
            ),
        }),
      bans,
      hasher,
      ...(now ? { now } : {}),
    });
  }

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
