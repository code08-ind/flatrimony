/** RFC 9457 problem+json for every error (docs/05 §4). Never leaks internals. */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { problem, type ErrorCode, type FieldError, type ProblemDetails } from '@flatrimony/shared';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly extra: Partial<Omit<ProblemDetails, 'type' | 'status' | 'code'>> = {},
  ) {
    super(code);
  }
}

function send(reply: FastifyReply, req: FastifyRequest, body: ProblemDetails) {
  return reply
    .status(body.status)
    .type('application/problem+json')
    .send({ ...body, requestId: req.id });
}

/**
 * Postgres errors carry the failing row in `detail` ("Failing row contains (…)") and query values in
 * `where`/`parameters`: names, dates of birth, tokens. Log only the fields that identify the
 * failure (docs/03 §13.1: never log personal data).
 */
export function loggableError(err: unknown): unknown {
  const e = err as Record<string, unknown> | null;
  if (!e || typeof e !== 'object' || typeof e.code !== 'string' || !('severity' in e)) return err;
  return {
    type: 'DatabaseError',
    code: e.code,
    constraint: e.constraint,
    table: e.table,
    column: e.column,
    routine: e.routine,
    stack: typeof e.stack === 'string' ? e.stack.split('\n').slice(1).join('\n') : undefined,
  };
}

export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((req, reply) =>
    send(reply, req, problem('not_found', { title: 'Not found' })),
  );

  app.setErrorHandler((err: FastifyError | ApiError, req, reply) => {
    if (err instanceof ApiError) {
      return send(reply, req, problem(err.code, err.extra));
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const errors: FieldError[] = err.validation.flatMap((v) => {
        const issue = (v.params?.issue ?? {}) as { code?: unknown; keys?: unknown };
        const code = String(issue.code ?? v.keyword);
        // '/device/platform' → 'body.device.platform'; the root is 'body' (no trailing dot).
        const base = [
          err.validationContext ?? 'body',
          ...v.instancePath.split('/').filter(Boolean),
        ].join('.');
        // One error per unknown key, named, so clients see exactly what to remove.
        const keys = (v.params as { keys?: unknown } | undefined)?.keys ?? issue.keys;
        if (code === 'unrecognized_keys' && Array.isArray(keys))
          return keys.map((key) => ({
            path: `${base}.${String(key)}`,
            code,
            message: 'Unknown field',
          }));
        return [{ path: base, code, message: v.message ?? 'Invalid value' }];
      });
      return send(reply, req, problem('validation.failed', { title: 'Validation failed', errors }));
    }
    // Text Postgres cannot store (NUL bytes, invalid encoding) is the client's input, not a 500.
    if (['22021', '22P05'].includes((err as { code?: string }).code ?? '')) {
      return send(
        reply,
        req,
        problem('validation.failed', {
          title: 'Validation failed',
          errors: [
            {
              path: 'body',
              code: 'invalid_characters',
              message: 'Contains characters that cannot be stored',
            },
          ],
        }),
      );
    }
    if (err.statusCode === 415) {
      return send(
        reply,
        req,
        problem('unsupported_media_type', { title: 'Unsupported media type' }),
      );
    }
    if (err.statusCode === 413)
      return send(reply, req, problem('payload_too_large', { title: 'Payload too large' }));
    if (err.statusCode === 400 || err.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return send(reply, req, problem('bad_request', { title: 'Bad request' }));
    }
    if (err.statusCode === 429)
      return send(reply, req, problem('rate_limited', { title: 'Too many requests' }));
    req.log.error({ err: loggableError(err) }, 'unhandled error');
    return send(reply, req, problem('internal', { title: 'Something went wrong' }));
  });
});
