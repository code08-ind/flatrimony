import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ProblemDetails, PublicConfig } from '@flatrimony/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { inMemorySystemRepository } from '../src/modules/system/repository.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ env: loadEnv({ NODE_ENV: 'test' }) });
});
afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('GET /healthz is up with no dependencies', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });

  it('GET /readyz reports the database as skipped until a DB is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { database: 'skipped' } });
  });

  it('GET /readyz returns 503 when the database check fails', async () => {
    const failing = await buildApp({
      env: loadEnv({ NODE_ENV: 'test' }),
      systemRepo: { ...inMemorySystemRepository(), ping: async () => ({ ok: false }) },
    });
    const res = await failing.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database).toBe('fail');
    await failing.close();
  });

  it('echoes a safe client request id and replaces an unsafe one', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(ok.headers['x-request-id']).toBe('abc-123');
    const bad = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': '<script>' },
    });
    expect(bad.headers['x-request-id']).toMatch(/^req_/);
  });
});

describe('GET /v1/config', () => {
  it('returns the public remote config contract', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.statusCode).toBe(200);
    expect(PublicConfig.parse(res.json())).toEqual({
      dailyLikeLimit: 50,
      features: { videoTours: false, houseAgreement: false },
      minSupportedAppVersion: '1.0.0',
    });
  });
});

describe('GET /v1/reference', () => {
  it('returns reference data and varies by language', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reference',
      headers: { 'accept-language': 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.vary).toContain('Accept-Language');
    expect(Object.keys(res.json()).sort()).toEqual([
      'areas',
      'habitTags',
      'products',
      'scenarioQuestions',
    ]);
  });

  it('refuses to serialise a response that breaks the contract', async () => {
    const broken = await buildApp({
      env: loadEnv({ NODE_ENV: 'test' }),
      systemRepo: {
        ...inMemorySystemRepository(),
        publicConfig: async () => ({ dailyLikeLimit: -1 }) as never,
      },
    });
    const res = await broken.inject({ method: 'GET', url: '/v1/config' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal', status: 500 });
    expect(res.body).not.toContain('dailyLikeLimit');
    await broken.close();
  });
});

describe('errors are RFC 9457 problem details', () => {
  it('404 for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = ProblemDetails.parse(res.json());
    expect(body.code).toBe('not_found');
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('env', () => {
  it('requires DATABASE_URL outside local', () => {
    expect(() => loadEnv({ APP_ENV: 'staging' })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(
      loadEnv({ CORS_ALLOWED_ORIGINS: 'https://a.test, https://b.test' }).CORS_ALLOWED_ORIGINS,
    ).toEqual(['https://a.test', 'https://b.test']);
  });
});
