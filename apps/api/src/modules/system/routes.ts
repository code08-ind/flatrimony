/** Health and public config/reference endpoints (docs/05 §8.1). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HealthResponse, PublicConfig, ReadyResponse, ReferenceData } from '@flatrimony/shared';
import type { SystemRepository } from './repository.js';

export interface SystemRoutesOptions {
  repo: SystemRepository;
}

export const healthRoutes: FastifyPluginAsyncZod<SystemRoutesOptions> = async (app, { repo }) => {
  app.get('/healthz', { schema: { response: { 200: HealthResponse } } }, async () => ({
    status: 'ok' as const,
  }));

  app.get(
    '/readyz',
    { schema: { response: { 200: ReadyResponse, 503: ReadyResponse } } },
    async (_req, reply) => {
      const db = await repo.ping();
      const body = {
        status: db.ok ? ('ready' as const) : ('not_ready' as const),
        checks: {
          database: db.ok ? ('ok' as const) : db.skipped ? ('skipped' as const) : ('fail' as const),
        },
        ...(db.migrationVersion ? { migrationVersion: db.migrationVersion } : {}),
      };
      return reply.status(db.ok || db.skipped ? 200 : 503).send(body);
    },
  );
};

export const v1SystemRoutes: FastifyPluginAsyncZod<SystemRoutesOptions> = async (app, { repo }) => {
  app.get('/config', { schema: { response: { 200: PublicConfig } } }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return repo.publicConfig();
  });

  app.get('/reference', { schema: { response: { 200: ReferenceData } } }, async (req, reply) => {
    const locale = (req.headers['accept-language'] ?? '').toLowerCase().startsWith('hi')
      ? 'hi'
      : 'en';
    reply.header('vary', 'Accept-Language');
    reply.header('cache-control', 'public, max-age=300');
    return repo.referenceData(locale);
  });
};
