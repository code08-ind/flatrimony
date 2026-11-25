/**
 * DigiLocker identity verification (FR-VER-01..03, 06, 07; docs/05 §8.4):
 *   POST /v1/verifications/digilocker  { consentVersion } → 201 { verificationId, redirectUrl, expiresAt }
 *   GET  /v1/verifications/:id         the caller's attempt { status, failureCode? } (the app polls)
 *   GET  /v1/verifications             the caller's attempts, newest first
 *   POST /webhooks/digilocker          the provider says a session finished (Standard Webhooks
 *                                      signature); the result is fetched from the provider, never
 *                                      taken from the webhook
 * Nothing about the identity (name, DOB, gender, DigiLocker id) is ever logged or returned.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  RATE_LIMITS,
  StartDigiLockerRequest,
  StartDigiLockerResponse,
  Verification,
  VerificationList,
} from '@flatrimony/shared';
import { verifyWebhook } from '../../lib/standard-webhooks.js';
import { ApiError } from '../../plugins/errors.js';
import type { MeRepository } from '../me/repository.js';
import { istToday } from '../me/routes.js';
import { DigiLockerUnavailable, type DigiLockerProvider } from './provider.js';
import { StartInProgress, type VerificationRepository } from './repository.js';

export interface VerificationRoutesOptions {
  repo: VerificationRepository;
  /** Profile state and the published policy versions. */
  me: Pick<MeRepository, 'profileState' | 'legalVersions'>;
  provider: DigiLockerProvider;
  now?: () => number;
}

const unavailable = () =>
  new ApiError('upstream.unavailable', {
    title: 'Identity verification is not available',
    detail: 'Try again in a moment.',
  });

export const verificationRoutes: FastifyPluginAsyncZod<VerificationRoutesOptions> = async (
  app,
  opts,
) => {
  const { repo, me, provider } = opts;

  app.post(
    '/verifications/digilocker',
    {
      onRequest: app.requireUser,
      config: {
        rateLimit: {
          bucket: 'verification-start',
          limit: RATE_LIMITS.verificationStart.limit,
          windowMs: RATE_LIMITS.verificationStart.windowMs,
        },
      },
      schema: { body: StartDigiLockerRequest, response: { 201: StartDigiLockerResponse } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      const state = await me.profileState(userId);
      if (!state) throw new ApiError('profile.incomplete', { title: 'Create your profile first' });
      if (state.deleted) throw new ApiError('auth.account_deleted', { title: 'Account deleted' });
      if (state.suspendedUntil)
        throw new ApiError('account.suspended', { title: 'Account suspended' });
      if (state.isIdentityVerified)
        throw new ApiError('conflict', { title: 'You are already verified' });

      // Explicit consent to identity verification (DigiLocker and provider terms; DPDP).
      const current = (await me.legalVersions())?.identity_verification;
      if (!current)
        throw new ApiError('upstream.unavailable', {
          title: 'Identity verification is not open yet',
          detail: 'The identity verification notice is not published yet.',
        });
      if (req.body.consentVersion !== current)
        throw new ApiError('validation.failed', {
          title: 'Validation failed',
          errors: [
            {
              path: 'body.consentVersion',
              code: 'outdated_version',
              message: 'Agree to the current identity verification notice',
            },
          ],
        });

      const id = randomUUID();
      let session;
      try {
        session = await provider.start({ verificationId: id });
      } catch (err) {
        if (err instanceof DigiLockerUnavailable) {
          req.log.warn({ err: err.message }, 'digilocker start failed');
          throw unavailable();
        }
        throw err;
      }
      try {
        await repo.start(userId, {
          id,
          provider: provider.name,
          providerRef: session.providerRef,
          expiresAt: session.expiresAt,
          consentVersion: current,
        });
      } catch (err) {
        if (err instanceof StartInProgress)
          throw new ApiError('conflict', { title: 'A verification is already starting' });
        throw err;
      }
      reply.code(201);
      return {
        verificationId: id,
        redirectUrl: session.redirectUrl,
        expiresAt: session.expiresAt.toISOString(),
      };
    },
  );

  app.get(
    '/verifications/:verificationId',
    {
      onRequest: app.requireUser,
      schema: { params: z.object({ verificationId: z.uuid() }), response: { 200: Verification } },
    },
    async (req) => {
      const found = await repo.get(req.user!.id, req.params.verificationId);
      if (!found) throw new ApiError('not_found', { title: 'Verification not found' });
      return found;
    },
  );

  app.get(
    '/verifications',
    { onRequest: app.requireUser, schema: { response: { 200: VerificationList } } },
    async (req) => ({ verifications: await repo.list(req.user!.id) }),
  );
};

export interface DigiLockerWebhookOptions {
  repo: VerificationRepository;
  provider: DigiLockerProvider;
  /** Standard Webhooks keys (DIGILOCKER_WEBHOOK_SECRETS). */
  keys: readonly Buffer[];
  now?: () => number;
}

const WebhookBody = z.object({ providerRef: z.string().min(1).max(200) }).loose();

export const digilockerWebhookRoutes: FastifyPluginAsync<DigiLockerWebhookOptions> = async (
  app,
  opts,
) => {
  const now = opts.now ?? Date.now;
  // Keep the exact bytes for the signature (re-serialising JSON would break it).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 16 * 1024 },
    (_req, body, done) => done(null, body),
  );

  // The provider's deliveries are not throttled with user traffic (as the Send SMS hook); the
  // signature check comes first and bounds the work an unsigned request causes.
  app.post('/webhooks/digilocker', { config: { rateLimit: false } }, async (req, reply) => {
    const raw = req.body as Buffer;
    const verdict = verifyWebhook(req.headers, raw, opts.keys, Math.floor(now() / 1000));
    if (!verdict.ok) {
      req.log.warn({ reason: verdict.reason }, 'digilocker webhook rejected');
      return reply.code(401).send({ error: 'invalid signature' });
    }
    let parsed;
    try {
      parsed = WebhookBody.safeParse(JSON.parse(raw.toString('utf8')));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) return reply.code(400).send({ error: 'bad request' });
    const { providerRef } = parsed.data;

    const attempt = await opts.repo.findPending(opts.provider.name, providerRef);
    // Unknown or already decided: acknowledge so the provider stops retrying.
    if (!attempt) return { received: true };

    let result;
    try {
      result = await opts.provider.result(providerRef);
    } catch (err) {
      if (err instanceof DigiLockerUnavailable) {
        req.log.warn({ err: err.message }, 'digilocker result fetch failed');
        return reply.code(503).send({ error: 'try again' }); // the provider retries
      }
      throw err;
    }
    if (!result || result.state === 'pending') return { received: true };

    if (result.state === 'failed') {
      await opts.repo.fail(attempt.id, result.reason);
      req.log.info(
        { verificationId: attempt.id, status: 'failed', failureCode: result.reason },
        'verification finished',
      );
      return { received: true };
    }
    const outcome = await opts.repo.complete(attempt.id, result.identity, {
      today: istToday(now()),
    });
    req.log.info(
      {
        verificationId: attempt.id,
        status: outcome.status,
        ...(outcome.status === 'failed' ? { failureCode: outcome.failureCode } : {}),
        ...(outcome.status === 'verified' && outcome.categoryChanged
          ? { categoryChanged: true }
          : {}),
      },
      'verification finished',
    );
    return { received: true };
  });
};
