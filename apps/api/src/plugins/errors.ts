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

export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((req, reply) =>
    send(reply, req, problem('not_found', { title: 'Not found' })),
  );

  app.setErrorHandler((err: FastifyError | ApiError, req, reply) => {
    if (err instanceof ApiError) {
      return send(reply, req, problem(err.code, err.extra));
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const errors: FieldError[] = err.validation.map((v) => ({
        path: `${err.validationContext ?? 'body'}${v.instancePath.replace(/\//g, '.')}`,
        code: String(
          v.params?.issue && typeof v.params.issue === 'object' && 'code' in v.params.issue
            ? v.params.issue.code
            : v.keyword,
        ),
        message: v.message ?? 'Invalid value',
      }));
      return send(reply, req, problem('validation.failed', { title: 'Validation failed', errors }));
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
    req.log.error({ err }, 'unhandled error');
    return send(reply, req, problem('internal', { title: 'Something went wrong' }));
  });
});
