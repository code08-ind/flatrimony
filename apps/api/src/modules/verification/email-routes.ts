/**
 * Work and college email verification (FR-VER-05, T3.3; docs/05 §8.4):
 *   POST /v1/verifications/email          { email, type } → 201 { verificationId, expiresAt }
 *                                         and a one-time link to that address (24 hours)
 *   POST /v1/verifications/email/confirm  { token } (public: the link opens on any device)
 *                                         → 200 { status: "verified", type }
 * The attempt shows in GET /v1/verifications like DigiLocker's. The address is never stored or
 * logged (only its domain and an HMAC), nor are links or tokens.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConfirmEmailVerificationRequest,
  ConfirmEmailVerificationResponse,
  EMAIL_LINK_TTL_MS,
  EMAIL_LINKS_PER_ADDRESS_PER_DAY,
  RATE_LIMITS,
  StartEmailVerificationRequest,
  StartEmailVerificationResponse,
  emailProblem,
  normaliseEmail,
} from '@flatrimony/shared';
import type { EmailProvider, MockEmailProvider } from '../../lib/email.js';
import type { IdentifierHasher } from '../../lib/hashing.js';
import { ApiError } from '../../plugins/errors.js';
import type { MeRepository } from '../me/repository.js';
import { emailLink, emailVerificationMessage } from './email-message.js';
import type { EmailVerificationRepository } from './email-repository.js';

export interface EmailVerificationRoutesOptions {
  repo: EmailVerificationRepository;
  me: Pick<MeRepository, 'profileState'>;
  email: EmailProvider;
  hasher: IdentifierHasher;
  /** The web app's origin: the link opens its confirm page. */
  webAppUrl: string;
  now?: () => number;
}

/** How long the API waits for the email vendor before saying "try again". */
const SEND_TIMEOUT_MS = 10_000;

const PROBLEM_MESSAGE = {
  invalid_email: 'Enter an email address',
  personal_domain: 'Use your work email, not a personal one',
  disposable_domain: 'Use a work or college email you can keep',
  not_a_college_domain: 'Use your college email (ending in .ac.in, .edu.in or .edu)',
} as const;

const linkProblem = (code: 'link_invalid' | 'link_expired' | 'email_in_use', message: string) =>
  new ApiError('verification.failed', {
    title: 'This link cannot be used',
    errors: [{ path: 'body.token', code, message }],
  });

export const tokenHash = (token: string) => createHash('sha256').update(token).digest();

export const emailVerificationRoutes: FastifyPluginAsyncZod<
  EmailVerificationRoutesOptions
> = async (app, opts) => {
  const { repo, me, email, hasher } = opts;
  const now = opts.now ?? Date.now;

  app.post(
    '/verifications/email',
    {
      onRequest: app.requireUser,
      config: {
        rateLimit: {
          bucket: 'email-verification-start',
          limit: RATE_LIMITS.emailVerificationStart.limit,
          windowMs: RATE_LIMITS.emailVerificationStart.windowMs,
        },
      },
      schema: {
        body: StartEmailVerificationRequest,
        response: { 201: StartEmailVerificationResponse },
      },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      const state = await me.profileState(userId);
      if (!state) throw new ApiError('profile.incomplete', { title: 'Create your profile first' });
      if (state.deleted) throw new ApiError('auth.account_deleted', { title: 'Account deleted' });
      if (state.suspendedUntil)
        throw new ApiError('account.suspended', { title: 'Account suspended' });

      const { type } = req.body;
      const problem = emailProblem(type, req.body.email);
      const address = normaliseEmail(req.body.email);
      if (problem || !address)
        throw new ApiError('validation.failed', {
          title: 'Validation failed',
          errors: [
            {
              path: 'body.email',
              code: problem ?? 'invalid_email',
              message: PROBLEM_MESSAGE[problem ?? 'invalid_email'],
            },
          ],
        });

      const badges = await repo.badges(userId);
      if (!badges) throw new ApiError('profile.incomplete', { title: 'Create your profile first' });
      if (type === 'work_email' ? badges.hasWorkBadge : badges.hasCollegeBadge)
        throw new ApiError('conflict', { title: 'This badge is already on your profile' });

      const id = randomUUID();
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now() + EMAIL_LINK_TTL_MS);
      const started = await repo.start(userId, {
        id,
        type,
        domain: address.domain,
        addressHash: hasher('email', address.canonical),
        tokenHash: tokenHash(token),
        expiresAt,
        maxPerAddressPerDay: EMAIL_LINKS_PER_ADDRESS_PER_DAY,
      });
      if (started.status === 'in_progress')
        throw new ApiError('conflict', { title: 'A link is already on its way' });
      if (started.status === 'address_limited')
        throw new ApiError('rate_limited', {
          title: 'Too many links to this address today',
          detail: 'Try again tomorrow, or use another address.',
          errors: [
            {
              path: 'body.email',
              code: 'address_limited',
              message: 'This address got its links for today',
            },
          ],
        });

      try {
        await email.send(
          emailVerificationMessage({
            to: address.address,
            type,
            locale: badges.locale,
            link: emailLink(opts.webAppUrl, badges.locale === 'hi' ? 'hi' : 'en', token),
          }),
          AbortSignal.timeout(SEND_TIMEOUT_MS),
        );
      } catch (err) {
        await repo.sendFailed(id);
        req.log.warn({ verificationId: id, err: (err as Error).name }, 'email link not sent');
        throw new ApiError('upstream.unavailable', {
          title: 'The email could not be sent',
          detail: 'Try again in a moment.',
        });
      }
      req.log.info({ verificationId: id, type }, 'email link sent');
      reply.code(201);
      return { verificationId: id, expiresAt: expiresAt.toISOString() };
    },
  );

  app.post(
    '/verifications/email/confirm',
    {
      config: {
        rateLimit: {
          bucket: 'email-verification-confirm',
          limit: RATE_LIMITS.emailVerificationConfirm.limit,
          windowMs: RATE_LIMITS.emailVerificationConfirm.windowMs,
        },
      },
      schema: {
        body: ConfirmEmailVerificationRequest,
        response: { 200: ConfirmEmailVerificationResponse },
      },
    },
    async (req) => {
      const outcome = await repo.confirm(tokenHash(req.body.token));
      switch (outcome.status) {
        case 'verified':
          req.log.info({ type: outcome.type, status: 'verified' }, 'email verification confirmed');
          return { status: 'verified' as const, type: outcome.type };
        case 'expired':
          throw linkProblem('link_expired', 'This link has expired. Ask for a new one in the app.');
        case 'email_in_use':
          req.log.info({ type: outcome.type, status: 'failed' }, 'email verification confirmed');
          throw linkProblem(
            'email_in_use',
            'This email is already confirmed on a Flatrimony account.',
          );
        case 'invalid':
          throw linkProblem(
            'link_invalid',
            'This link has been used or replaced. Ask for a new one in the app.',
          );
      }
    },
  );
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Local development only (the mock email provider): the latest message to an address, for tests
 * and manual QA on this machine. The address is in the body, never the URL; loopback callers only.
 */
export const devEmailOutboxRoutes: FastifyPluginAsyncZod<{ provider: MockEmailProvider }> = async (
  app,
  opts,
) => {
  app.post(
    '/dev/email-outbox/latest',
    { config: { rateLimit: false }, schema: { body: z.object({ email: z.string().max(254) }) } },
    async (req, reply) => {
      if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply.code(404).send({});
      const address = normaliseEmail(req.body.email);
      const message = address ? opts.provider.latest(address.address) : undefined;
      if (!message) return reply.code(404).send({});
      const link = /https?:\/\/\S+/.exec(message.text)?.[0] ?? null;
      return { subject: message.subject, text: message.text, link };
    },
  );
};
