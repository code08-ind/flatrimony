/**
 * Supabase JWT authentication (docs/03 §14, docs/05 §2–3).
 *
 * Every request may carry `Authorization: Bearer <access_token>`. The token is verified for
 * signature (JWKS for asymmetric signing keys, or the legacy HS256 secret), issuer, audience
 * `authenticated`, expiry and a UUID `sub`. Routes opt in with `preHandler: app.requireUser`
 * (or `app.requireRole('moderator', 'admin')`). Anything unverifiable fails closed with 401.
 *
 * Not yet here (needs a Supabase project): the 60 s cached session-revocation check. Deleted and
 * suspended accounts are refused per route from the profile (modules/me, T2.5: reads allowed,
 * writes `403 account.suspended`); later write routes reuse that check.
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
import { ApiError } from './errors.js';

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
}

export const authPlugin = fp<AuthPluginOptions>(async (app: FastifyInstance, { verifier }) => {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header || !verifier) return;
    const match = BEARER.exec(header);
    if (!match) return; // malformed header: treated as anonymous; protected routes return 401
    try {
      req.user = await verifier(match[1]!);
    } catch (err) {
      req.log.info({ reason: (err as Error).name }, 'access token rejected');
    }
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
});
