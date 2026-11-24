/**
 * Supabase JWT authentication (docs/03 §14, docs/05 §2–3).
 *
 * Every request may carry `Authorization: Bearer <access_token>`. The token is verified for
 * signature (JWKS for asymmetric signing keys, or the legacy HS256 secret), issuer, audience
 * `authenticated`, expiry and a UUID `sub`. Routes opt in with `onRequest: app.requireUser` (before
 * body validation, so a request without a session is 401, not 422) or `preHandler`
 * (or `app.requireRole('moderator', 'admin')`). Anything unverifiable fails closed with 401.
 *
 * With `sessions` (the server always passes it when it has a database), the token's session must
 * still exist in `auth.sessions` (modules/auth/sessions.ts, cached 60 s): a signed-out or revoked
 * session's token stops working at once rather than when it expires. Tokens without a
 * `session_id` are then refused. If the check cannot run (database down) the request fails with
 * 503, not 401, so clients do not take an outage for a sign-out. Deleted and suspended accounts
 * are refused per route from the profile (modules/me, T2.5: reads allowed, writes
 * `403 account.suspended`); later write routes reuse that check.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { ApiError, loggableError } from './errors.js';
import type { SessionLookup } from '../modules/auth/sessions.js';

export type AppRole = 'user' | 'moderator' | 'admin';

export interface AuthUser {
  id: string;
  appRole: AppRole;
  sessionId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    requireUser: preHandlerAsyncHookHandler;
    requireRole: (...roles: AppRole[]) => preHandlerAsyncHookHandler;
  }
}

export interface JwtVerifierOptions {
  issuer: string;
  /** Remote JWKS (Supabase asymmetric signing keys). Preferred. */
  jwksUrl?: string;
  /** Injected key resolver (tests, or a pre-built JWKS). */
  jwks?: JWTVerifyGetKey;
  /** Legacy shared secret (HS256). Used only when no JWKS is configured. */
  secret?: string;
  /**
   * Accept only sessions that were established with a phone OTP (`amr` contains `otp`).
   * Default true: Flatrimony has no other sign-in method, so a password or email session is a
   * misconfiguration or an attack (QA T2.2 D1). Refreshed sessions keep their original `amr`.
   */
  requireOtp?: boolean;
}

export type JwtVerifier = (token: string) => Promise<AuthUser>;

const Claims = z.object({
  sub: z.uuid(),
  role: z.literal('authenticated'),
  session_id: z.string().optional(),
  app_metadata: z
    .object({ role: z.enum(['moderator', 'admin']).optional() })
    .loose()
    .optional(),
  // Authentication methods of the session (e.g. [{ method: 'otp', timestamp }]).
  amr: z.array(z.object({ method: z.string() }).loose()).optional(),
});

export function createJwtVerifier(opts: JwtVerifierOptions): JwtVerifier {
  const asymmetric =
    opts.jwks ?? (opts.jwksUrl ? createRemoteJWKSet(new URL(opts.jwksUrl)) : undefined);
  const secret = opts.secret ? new TextEncoder().encode(opts.secret) : undefined;
  if (!asymmetric && !secret) throw new Error('JWT verifier needs a JWKS or a secret');

  return async (token) => {
    const verifyOpts = {
      issuer: opts.issuer,
      audience: 'authenticated',
      requiredClaims: ['sub', 'exp', 'iat'],
      clockTolerance: 5,
    };
    const { payload } = asymmetric
      ? await jwtVerify(token, asymmetric, {
          ...verifyOpts,
          algorithms: ['ES256', 'RS256', 'EdDSA'],
        })
      : await jwtVerify(token, secret!, { ...verifyOpts, algorithms: ['HS256'] });
    const claims = Claims.parse(payload);
    if ((opts.requireOtp ?? true) && !claims.amr?.some((a) => a.method === 'otp')) {
      throw new Error('session_not_established_by_otp');
    }
    return {
      id: claims.sub,
      appRole: claims.app_metadata?.role ?? 'user',
      ...(claims.session_id ? { sessionId: claims.session_id } : {}),
    };
  };
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

function unauthenticated(reply: FastifyReply): never {
  reply.header('www-authenticate', 'Bearer');
  throw new ApiError('auth.unauthenticated', { title: 'Sign in required' });
}

export interface AuthPluginOptions {
  /** Undefined means auth is not configured: every protected route answers 401. */
  verifier?: JwtVerifier;
  /** Is the token's session still alive? (cached; see modules/auth/sessions.ts) */
  sessions?: SessionLookup;
}

export const authPlugin = fp<AuthPluginOptions>(
  async (app: FastifyInstance, { verifier, sessions }) => {
    app.decorateRequest('user', null);

    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const header = req.headers.authorization;
      if (!header || !verifier) return;
      const match = BEARER.exec(header);
      if (!match) return; // malformed header: treated as anonymous; protected routes return 401
      let user: AuthUser;
      try {
        user = await verifier(match[1]!);
      } catch (err) {
        req.log.info({ reason: (err as Error).name }, 'access token rejected');
        return;
      }
      if (sessions) {
        if (!user.sessionId) {
          req.log.info({ reason: 'no_session_id' }, 'access token rejected');
          return;
        }
        let active: boolean;
        try {
          active = await sessions(user.sessionId, user.id);
        } catch (err) {
          req.log.warn({ err: loggableError(err) }, 'session check failed');
          reply.header('retry-after', 5);
          throw new ApiError('upstream.unavailable', {
            title: 'Sign-in check unavailable',
            detail: 'Try again in a moment.',
          });
        }
        if (!active) {
          req.log.info({ reason: 'session_revoked' }, 'access token rejected');
          return;
        }
      }
      req.user = user;
    });

    const requireUser: preHandlerAsyncHookHandler = async (req, reply) => {
      if (!req.user) unauthenticated(reply);
    };

    app.decorate('requireUser', requireUser);
    app.decorate('requireRole', (...roles: AppRole[]): preHandlerAsyncHookHandler => {
      return async (req, reply) => {
        if (!req.user) unauthenticated(reply);
        // Admin surfaces are hidden from everyone else (docs/05 §3 rule 1): 404, not 403.
        if (!roles.includes(req.user.appRole))
          throw new ApiError('not_found', { title: 'Not found' });
      };
    });
  },
);
