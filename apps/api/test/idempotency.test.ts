import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { memoryIdempotencyStore } from '../src/lib/stores.js';
import type { AuthUser } from '../src/plugins/auth.js';

const USER = '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
const OTHER = '7c1e9a2b-4d3f-4e5a-8b6c-0d1e2f3a4b5c';
const KEY = randomUUID(); // generated, so no secret-looking literal in the repo
const DAY = 24 * 60 * 60_000;

async function setup() {
  let clock = 1_000_000_000_000;
  let calls = 0;
  let fail = false;
  let release: (() => void) | undefined;
  const verifier = async (token: string): Promise<AuthUser> => ({
    id: token === 'other.t.t' ? OTHER : USER,
    appRole: 'user',
  });
  const app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test' }),
    jwtVerifier: verifier,
    idempotencyStore: memoryIdempotencyStore(DAY),
    now: () => clock,
  });
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.post(
    '/test/messages',
    {
      preHandler: app.requireUser,
      config: { idempotent: true },
      schema: { body: z.object({ text: z.string() }) },
    },
    async (req, reply) => {
      calls += 1;
      if (fail) throw new Error('boom');
      if (req.body.text === 'slow') await new Promise<void>((r) => (release = r));
      return reply.code(201).send({ id: `msg-${calls}`, text: req.body.text });
    },
  );
  return {
    app,
    calls: () => calls,
    setFail: (v: boolean) => (fail = v),
    finishSlow: () => release?.(),
    tick: (ms: number) => (clock += ms),
  };
}

type App = Awaited<ReturnType<typeof setup>>['app'];
const send = (app: App, body: unknown, opts: { key?: string | null; token?: string } = {}) =>
  app.inject({
    method: 'POST',
    url: '/test/messages',
    headers: {
      authorization: `Bearer ${opts.token ?? 'user.t.t'}`,
      ...(opts.key === null ? {} : { 'idempotency-key': opts.key ?? KEY }),
    },
    payload: body as object,
  });

describe('idempotency', () => {
  it('replays the stored response for a retry without running the handler again', async () => {
    const { app, calls } = await setup();
    const first = await send(app, { text: 'hi' });
    const retry = await send(app, { text: 'hi' });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(calls()).toBe(1);
    await app.close();
  });

  it('409 idempotency.key_reused for the same key with a different body', async () => {
    const { app } = await setup();
    await send(app, { text: 'hi' });
    const res = await send(app, { text: 'different' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('idempotency.key_reused');
    await app.close();
  });

  it('requires a UUID Idempotency-Key', async () => {
    const { app } = await setup();
    for (const key of [null, 'abc', '12345']) {
      const res = await send(app, { text: 'hi' }, { key });
      expect(res.statusCode).toBe(422);
      expect(res.json().errors[0].path).toBe('header.idempotency-key');
    }
    await app.close();
  });

  it('scopes keys per user', async () => {
    const { app, calls } = await setup();
    await send(app, { text: 'hi' });
    const other = await send(app, { text: 'hi' }, { token: 'other.t.t' });
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(calls()).toBe(2);
    await app.close();
  });

  it('releases the key after a 5xx so the client can retry', async () => {
    const { app, calls, setFail } = await setup();
    setFail(true);
    expect((await send(app, { text: 'hi' })).statusCode).toBe(500);
    setFail(false);
    const retry = await send(app, { text: 'hi' });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(calls()).toBe(2);
    await app.close();
  });

  it('409 conflict while the original request is still running', async () => {
    const { app, finishSlow } = await setup();
    const first = send(app, { text: 'slow' });
    await new Promise((r) => setTimeout(r, 20));
    const concurrent = await send(app, { text: 'slow' });
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json().code).toBe('conflict');
    finishSlow();
    expect((await first).statusCode).toBe(201);
    await app.close();
  });

  it('forgets keys after 24 hours', async () => {
    const { app, calls, tick } = await setup();
    await send(app, { text: 'hi' });
    tick(DAY + 1);
    const later = await send(app, { text: 'hi' });
    expect(later.headers['idempotent-replayed']).toBeUndefined();
    expect(calls()).toBe(2);
    await app.close();
  });

  it('requires sign-in before the key is looked at', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/test/messages',
      headers: { 'idempotency-key': KEY },
      payload: { text: 'hi' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
