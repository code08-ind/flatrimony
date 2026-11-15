/**
 * Idempotency-Key handling (docs/05 §6.1) for routes with `config.idempotent: true`.
 *
 * - The header is required and must be a UUID; keys are scoped per user.
 * - First request: the key is claimed, the handler runs, and the response (non-5xx) is stored
 *   for 24 h. A 5xx or an aborted request releases the key so the client can retry.
 * - Retry with the same key and the same request: the stored response is replayed with
 *   `Idempotent-Replayed: true`; the handler does not run again.
 * - Same key, different request: 409 `idempotency.key_reused`.
 * - Same key while the first request is still running: 409 `conflict`.
 *
 * Idempotent routes must also use `preHandler: app.requireUser`; this plugin's check runs
 * after the route's own preHandlers.
 */
import { createHash } from 'node:crypto';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { HEADERS } from '@flatrimony/shared';
import { ApiError } from './errors.js';
import type { IdempotencyStore } from '../lib/stores.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    idempotent?: boolean;
  }
  interface FastifyRequest {
    idempotencyScope?: string;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IdempotencyOptions {
  store: IdempotencyStore;
  now?: () => number;
}

function requestHash(req: FastifyRequest): string {
  return createHash('sha256')
    .update(req.method)
    .update('\n')
    .update(req.url)
    .update('\n')
    .update(JSON.stringify(req.body ?? null))
    .digest('hex');
}

export const idempotencyPlugin = fp<IdempotencyOptions>(
  async (app: FastifyInstance, { store, now = Date.now }) => {
    const check: preHandlerAsyncHookHandler = async (req: FastifyRequest, reply: FastifyReply) => {
      const key = req.headers[HEADERS.idempotencyKey];
      if (typeof key !== 'string' || !UUID.test(key)) {
        throw new ApiError('validation.failed', {
          title: 'Validation failed',
          errors: [
            {
              path: 'header.idempotency-key',
              code: 'required',
              message: 'A UUID Idempotency-Key header is required',
            },
          ],
        });
      }
      if (!req.user) throw new ApiError('auth.unauthenticated', { title: 'Sign in required' });

      const scope = `${req.user.id}:${key.toLowerCase()}`;
      const hash = requestHash(req);
      const existing = await store.begin(scope, hash, now());

      if (!existing) {
        req.idempotencyScope = scope; // claimed: the handler runs and onSend stores the result
        return;
      }
      if (existing.requestHash !== hash) {
        throw new ApiError('idempotency.key_reused', {
          title: 'Idempotency key already used for a different request',
        });
      }
      if (existing.state === 'in_flight') {
        throw new ApiError('conflict', { title: 'The original request is still being processed' });
      }
      reply.header(HEADERS.idempotentReplayed, 'true');
      if (existing.response.contentType) reply.type(existing.response.contentType);
      return reply.code(existing.response.statusCode).send(existing.response.body);
    };

    app.addHook('onRoute', (route) => {
      if (!route.config?.idempotent) return;
      const own = route.preHandler
        ? Array.isArray(route.preHandler)
          ? route.preHandler
          : [route.preHandler]
        : [];
      route.preHandler = [...own, check];
    });

    app.addHook('onSend', async (req, reply, payload) => {
      const scope = req.idempotencyScope;
      if (!scope) return payload;
      req.idempotencyScope = undefined;
      if (reply.statusCode >= 500 || typeof payload !== 'string') {
        await store.release(scope);
        return payload;
      }
      const contentType = reply.getHeader('content-type');
      await store.complete(scope, {
        statusCode: reply.statusCode,
        contentType: typeof contentType === 'string' ? contentType : undefined,
        body: payload,
      });
      return payload;
    });

    // Client went away before a response was sent: free the key.
    app.addHook('onRequestAbort', async (req) => {
      if (req.idempotencyScope) await store.release(req.idempotencyScope);
    });
  },
);
