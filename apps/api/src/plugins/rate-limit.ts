/**
 * Fixed-window rate limits (docs/05 §6.3). Every request counts against the per-IP bucket;
 * signed-in requests also against the per-user bucket; routes may add their own bucket with
 * `config.rateLimit`. `config.rateLimit: false` exempts a route (health checks, SOS).
 * Responses carry RateLimit-Limit / -Remaining / -Reset; excess gets 429 `rate_limited`.
 *
 * The web app calls the API from its server on the user's behalf (tokens stay in HttpOnly cookies,
 * docs/05 §2), so every web user would share the web server's IP. With `trustedProxySecret`, a
 * request carrying that secret counts against the client IP the web server read from its own
 * trusted front end (`x-flatrimony-client-ip`); without the secret the header is ignored.
 */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { RATE_LIMITS } from '@flatrimony/shared';
import { ApiError } from './errors.js';
import type { RateLimitStore } from '../lib/stores.js';

export interface RouteRateLimit {
  /** Bucket name, e.g. 'swipes'. */
  bucket: string;
  limit: number;
  windowMs: number;
  /** Count per signed-in user (default) or per client IP. */
  by?: 'user' | 'ip';
}

declare module 'fastify' {
  interface FastifyContextConfig {
    rateLimit?: RouteRateLimit | false;
  }
}

export interface RateLimitOptions {
  store: RateLimitStore;
  /** Shared with the web app's server (WEB_PROXY_SECRET); enables the forwarded client IP. */
  trustedProxySecret?: string;
  now?: () => number;
}

interface Verdict {
  limit: number;
  remaining: number;
  resetAt: number;
  over: boolean;
}

export const rateLimitPlugin = fp<RateLimitOptions>(
  async (app: FastifyInstance, { store, now = Date.now, trustedProxySecret }) => {
    const secret = trustedProxySecret ? Buffer.from(trustedProxySecret) : null;
    /** The socket (or trusted front end) address, or the web server's forwarded client IP. */
    function clientIp(req: FastifyRequest): string {
      const sent = req.headers['x-flatrimony-proxy-secret'];
      const forwarded = req.headers['x-flatrimony-client-ip'];
      if (!secret || typeof sent !== 'string' || typeof forwarded !== 'string') return req.ip;
      const given = Buffer.from(sent);
      const trusted = given.length === secret.length && timingSafeEqual(given, secret);
      return trusted && isIP(forwarded) ? forwarded : req.ip;
    }

    async function check(
      bucket: string,
      limit: number,
      windowMs: number,
      t: number,
    ): Promise<Verdict> {
      const { count, resetAt } = await store.hit(bucket, windowMs, t);
      // The limit-th request is still allowed; only requests beyond it are over.
      return { limit, remaining: Math.max(0, limit - count), resetAt, over: count > limit };
    }

    // preHandler runs after authentication (onRequest), so per-user buckets see req.user.
    app.addHook('preHandler', async (req: FastifyRequest, reply) => {
      const route = req.routeOptions.config.rateLimit;
      if (route === false) return;
      const t = now();

      const ip = clientIp(req);
      const verdicts: Verdict[] = [];
      const g = RATE_LIMITS.globalPerIp;
      verdicts.push(await check(`ip:${ip}`, g.limit, g.windowMs, t));
      if (req.user) {
        const u = RATE_LIMITS.perUser;
        verdicts.push(await check(`user:${req.user.id}`, u.limit, u.windowMs, t));
      }
      if (route) {
        const subject = route.by === 'ip' || !req.user ? `ip:${ip}` : `user:${req.user.id}`;
        verdicts.push(await check(`${route.bucket}:${subject}`, route.limit, route.windowMs, t));
      }

      // Report the tightest bucket.
      const tightest = verdicts.reduce((a, b) => (b.remaining < a.remaining ? b : a));
      const resetSeconds = Math.max(0, Math.ceil((tightest.resetAt - t) / 1000));
      reply.header('ratelimit-limit', tightest.limit);
      reply.header('ratelimit-remaining', tightest.remaining);
      reply.header('ratelimit-reset', resetSeconds);

      const exceeded = verdicts.filter((v) => v.over);
      if (exceeded.length > 0) {
        // Retry after the longest-blocked bucket resets.
        const retryAfter = Math.max(...exceeded.map((v) => Math.ceil((v.resetAt - t) / 1000)));
        reply.header('ratelimit-reset', retryAfter);
        reply.header('retry-after', retryAfter);
        throw new ApiError('rate_limited', {
          title: 'Too many requests',
          retryAfterSeconds: retryAfter,
        });
      }
    });
  },
);
