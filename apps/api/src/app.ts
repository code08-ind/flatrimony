import { randomBytes } from 'node:crypto';
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
import type { SessionLookup } from './modules/auth/sessions.js';
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
import {
  createFieldCipher,
  ephemeralFieldKey,
  parseFieldKey,
  type FieldCipher,
} from './lib/field-crypto.js';
import type { IdentifierHasher } from './lib/hashing.js';
import { devDigiLockerRoutes } from './modules/verification/dev-routes.js';
import {
  mockDigiLockerProvider,
  type DigiLockerProvider,
  type MockDigiLocker,
} from './modules/verification/provider.js';
import type { VerificationRepository } from './modules/verification/repository.js';
import { digilockerWebhookRoutes, verificationRoutes } from './modules/verification/routes.js';
import type { MeRepository } from './modules/me/repository.js';
import type { PhotoStorage } from './lib/photo-storage.js';
import { cachedIdToken } from '@flatrimony/routing';
import { createCommutePreview, type CommutePreview } from './lib/commute-preview.js';
import {
  googlePlacesProvider,
  mockPlacesProvider,
  type PlacesProvider,
} from './modules/places/provider.js';
import { placesRoutes } from './modules/places/routes.js';
import type { ListingRepository } from './modules/listings/repository.js';
import { mockIntegrityVerifier, type IntegrityVerifier } from './lib/integrity.js';
import { s3VideoStorage, type VideoStorage } from './lib/video-storage.js';
import { listingRoutes } from './modules/listings/routes.js';

export interface BuildOptions {
  env: Env;
  systemRepo?: SystemRepository;
  /** Overrides the verifier built from env (tests). */
  jwtVerifier?: JwtVerifier;
  /** Session revocation check (Postgres auth.sessions in server.ts, cached; docs/05 §2). */
  sessionLookup?: SessionLookup;
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
  /**
   * DigiLocker verifications (Postgres in server.ts), built with the app's identifier hasher and
   * field cipher. Without it (or meRepo) the verification routes are not served.
   */
  verificationRepo?: (deps: {
    hasher: IdentifierHasher;
    cipher: FieldCipher;
  }) => VerificationRepository;
  /** Listings (Postgres in server.ts), built with the field cipher (addresses). Not served without it. */
  listingRepo?: (deps: { cipher: FieldCipher }) => ListingRepository;
  /** Listing photos (the `listing-photos` bucket; Supabase Storage in server.ts). */
  listingPhotoStorage?: PhotoStorage;
  /** Walkthrough videos (default: R2 from the R2_* settings, if set). */
  videoStorage?: VideoStorage;
  /** Play Integrity (default: from PLAY_INTEGRITY_PROVIDER). */
  integrity?: IntegrityVerifier;
  /** DigiLocker provider (default: from DIGILOCKER_PROVIDER; tests inject their own). */
  digilocker?: DigiLockerProvider;
  /** Profile photo storage (Supabase Storage in server.ts; tests inject a memory store). */
  photoStorage?: PhotoStorage;
  /** Place search (default: from PLACES_PROVIDER; tests inject their own). */
  placesProvider?: PlacesProvider;
  /** Commute zone previews (default: from ROUTING_URL, radius approximation without it). */
  commutePreview?: CommutePreview;
  /** Capture logs (tests assert that no personal data is logged). */
  logStream?: { write(line: string): void };
}

/** Place search from env: Google with its key, or the mock (never a silent fallback). */
function placesFromEnv(env: Env, repo: SystemRepository): PlacesProvider {
  if (env.PLACES_PROVIDER === 'google') {
    if (!env.GOOGLE_PLACES_API_KEY)
      throw new Error('PLACES_PROVIDER=google needs GOOGLE_PLACES_API_KEY');
    return googlePlacesProvider({ apiKey: env.GOOGLE_PLACES_API_KEY });
  }
  return mockPlacesProvider(async (locale) => (await repo.referenceData(locale)).areas);
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
  'req.headers["x-flatrimony-proxy-secret"]',
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
  sessionLookup,
  rateLimitStore,
  idempotencyStore,
  now,
  smsProvider,
  bansRepo,
  otpStore,
  meRepo,
  verificationRepo,
  listingRepo,
  listingPhotoStorage,
  videoStorage,
  integrity,
  digilocker,
  photoStorage,
  commutePreview,
  placesProvider,
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
  // Outside local development a signed-out token must stop working (docs/05 §2): no app without
  // the session check (server.ts passes the Postgres one).
  if (verifier && !sessionLookup && env.APP_ENV !== 'local')
    throw new Error('the session revocation check is required outside local development');
  await app.register(authPlugin, {
    ...(verifier ? { verifier } : {}),
    ...(sessionLookup ? { sessions: sessionLookup } : {}),
  });
  const limiter = rateLimitStore ?? memoryRateLimitStore();
  await app.register(rateLimitPlugin, {
    store: limiter,
    ...(env.WEB_PROXY_SECRET ? { trustedProxySecret: env.WEB_PROXY_SECRET } : {}),
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
  // DigiLocker identity verification (T3.1). The verified name is encrypted with
  // FIELD_ENCRYPTION_KEY (required outside local; a throwaway key in local development).
  const cipher = createFieldCipher(
    env.FIELD_ENCRYPTION_KEY ? parseFieldKey(env.FIELD_ENCRYPTION_KEY) : ephemeralFieldKey(),
  );
  const dlProvider: DigiLockerProvider =
    digilocker ??
    mockDigiLockerProvider({
      publicApiUrl: env.PUBLIC_API_URL ?? 'http://localhost:8080',
      ...(now ? { now } : {}),
    });
  // Webhook keys (required outside local); locally a throwaway one that only the mock knows.
  const dlKeys = env.DIGILOCKER_WEBHOOK_SECRETS
    ? parseWebhookSecrets(env.DIGILOCKER_WEBHOOK_SECRETS)
    : [randomBytes(32)];
  const verifications = meRepo && verificationRepo ? verificationRepo({ hasher, cipher }) : null;

  if (meRepo) {
    await app.register(meRoutes, {
      prefix: '/v1',
      repo: meRepo,
      ...(photoStorage ? { photos: photoStorage } : {}),
      ...(verifications ? { verifiedName: (id: string) => verifications.verifiedName(id) } : {}),
      commutePreview:
        commutePreview ??
        createCommutePreview({
          routingUrl: env.ROUTING_URL,
          // The routing service is private on Cloud Run: call it with a Google ID token.
          ...(env.APP_ENV === 'local' ? {} : { token: cachedIdToken() }),
          onRoutingError: (err) =>
            app.log.warn(
              { err: err.message, retryable: err.retryable },
              'routing failed; approximating',
            ),
        }),
      bans,
      hasher,
      ...(now ? { now } : {}),
    });
  }

  if (meRepo && verifications) {
    await app.register(verificationRoutes, {
      prefix: '/v1',
      repo: verifications,
      me: meRepo,
      provider: dlProvider,
      ...(now ? { now } : {}),
    });
    await app.register(digilockerWebhookRoutes, {
      repo: verifications,
      provider: dlProvider,
      keys: dlKeys,
      ...(now ? { now } : {}),
    });
    // The mock's consent page: local development, or an explicit opt-in on a test environment
    // (production refuses the mock provider).
    if (
      isMockDigiLocker(dlProvider) &&
      env.APP_ENV !== 'production' &&
      (env.APP_ENV === 'local' || env.DIGILOCKER_MOCK_CONSENT_PAGE === 'true')
    )
      await app.register(devDigiLockerRoutes, {
        mock: dlProvider,
        key: dlKeys[0]!,
        ...(now ? { now } : {}),
      });
  }

  // Listings for their owners (T3.5). The address is encrypted with FIELD_ENCRYPTION_KEY.
  if (listingRepo) {
    const videos =
      videoStorage ??
      (env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
        ? s3VideoStorage({
            endpoint: env.R2_ENDPOINT,
            region: env.R2_REGION,
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            bucket: env.R2_BUCKET,
          })
        : undefined);
    await app.register(listingRoutes, {
      prefix: '/v1',
      repo: listingRepo({ cipher }),
      ...(listingPhotoStorage ? { photos: listingPhotoStorage } : {}),
      ...(videos ? { videos } : {}),
      // Only the mock exists until the Play Console project (env.ts refuses it in production).
      integrity: integrity ?? mockIntegrityVerifier(now),
      ...(now ? { now } : {}),
    });
  }

  // Place search for the office/college picker (T2.8): the vendor key stays server-side.
  await app.register(placesRoutes, {
    prefix: '/v1',
    provider: placesProvider ?? placesFromEnv(env, repo),
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

const isMockDigiLocker = (p: DigiLockerProvider): p is MockDigiLocker =>
  'complete' in p && typeof (p as MockDigiLocker).complete === 'function';
