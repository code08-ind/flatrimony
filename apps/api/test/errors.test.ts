import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OtpGuardRequest, ProblemDetails } from '@flatrimony/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { ApiError } from '../src/plugins/errors.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ env: loadEnv({ NODE_ENV: 'test' }) });
  // Test-only routes exercising the error handler before real endpoints exist.
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.post('/test/validate', { schema: { body: OtpGuardRequest } }, async () => ({
    allowed: true,
  }));
  typed.get('/test/api-error', async () => {
    throw new ApiError('verification.required', {
      title: 'Verification required',
      detail: 'Verify to chat.',
    });
  });
  typed.get('/test/crash', async () => {
    throw new Error('secret internal detail');
  });
  typed.get('/test/rate', async () => {
    throw Object.assign(new Error('slow down'), { statusCode: 429 });
  });
});
afterAll(async () => {
  await app.close();
});

describe('error handler', () => {
  it('422 validation.failed lists the failing fields without echoing input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/validate',
      payload: { phone: '12345', deviceId: 'abcdefgh' },
    });
    expect(res.statusCode).toBe(422);
    const body = ProblemDetails.parse(res.json());
    expect(body.code).toBe('validation.failed');
    expect(body.errors?.[0]?.path).toBe('body.phone');
    expect(res.body).not.toContain('12345');
  });

  it('400 bad_request for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/validate',
      headers: { 'content-type': 'application/json' },
      payload: '{"phone":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('bad_request');
  });

  it('413 for bodies over 100 KB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/validate',
      payload: { phone: '+919812345678', deviceId: 'x'.repeat(110 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('payload_too_large');
  });

  it('maps ApiError to its catalogue status', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/api-error' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'verification.required', detail: 'Verify to chat.' });
  });

  it('500 internal never leaks the error message', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret internal detail');
  });

  it('429 rate_limited', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/rate' });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate_limited');
  });
});

describe('loggableError', () => {
  it('drops the failing row and query values from Postgres errors', async () => {
    const { loggableError } = await import('../src/plugins/errors.js');
    const pgErr = Object.assign(new Error('new row violates check constraint'), {
      severity: 'ERROR',
      code: '23514',
      constraint: 'profiles_bio_chk',
      table: 'profiles',
      detail: 'Failing row contains (Karan, 2002-04-18, secret bio).',
      where: 'SQL statement',
    });
    const out = JSON.stringify(loggableError(pgErr));
    expect(out).toContain('profiles_bio_chk');
    expect(out).not.toContain('Karan');
    expect(out).not.toContain('Failing row');
    expect(out).not.toContain('new row violates'); // the message can quote values too
    const plain = new Error('x');
    expect(loggableError(plain)).toBe(plain);
  });
});
