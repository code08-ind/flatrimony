import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { HEADERS } from '@flatrimony/shared';
import type { Env } from './env.js';
import { errorsPlugin } from './plugins/errors.js';
import { genReqId } from './plugins/request-id.js';
import { healthRoutes, v1SystemRoutes } from './modules/system/routes.js';
import { inMemorySystemRepository, type SystemRepository } from './modules/system/repository.js';

export interface BuildOptions {
  env: Env;
  systemRepo?: SystemRepository;
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

export async function buildApp({ env, systemRepo }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL, redact: REDACT },
    genReqId,
    requestIdHeader: false,
    bodyLimit: 100 * 1024, // docs/03 §14: body ≤ 100 KB
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header(HEADERS.requestId, req.id);
    reply.header('x-content-type-options', 'nosniff');
  });

  await app.register(errorsPlugin);

  const repo = systemRepo ?? inMemorySystemRepository();
  await app.register(healthRoutes, { repo });
  await app.register(v1SystemRoutes, { prefix: '/v1', repo });

  return app;
}
