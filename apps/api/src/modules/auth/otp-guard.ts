/**
 * POST /v1/auth/otp-guard (docs/05 §2, §6.3; FR-AUTH-02, FR-AUTH-08; T2.3).
 *
 * Called by the app BEFORE asking Supabase Auth for an OTP. The phone and device id are HMAC'd at
 * once (never logged or stored raw).
 *
 * Order matters (code review + QA, T2.3):
 *  1. Limits are checked IP → device → phone with sliding windows, and NOTHING is recorded unless
 *     all three pass. A caller already over its own IP/device budget therefore cannot burn a
 *     victim's per-phone quota (targeted lockout), and rejected calls cost nobody anything.
 *  2. Only then are bans checked. A request over any limit gets 429 before any ban lookup, so the
 *     limits also bound how fast anyone can probe whether a number is banned.
 *
 * This endpoint is advisory: anyone with the public anon key can call Auth's /otp directly. The
 * enforceable part (banned phone, 5 OTPs SENT per phone per 15 min) is repeated in the Send SMS
 * hook via `createSendSmsGate`.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { OtpGuardRequest, OtpGuardResponse, OTP_LIMITS } from '@flatrimony/shared';
import { ApiError } from '../../plugins/errors.js';
import type { IdentifierHasher } from '../../lib/hashing.js';
import {
  ipKey,
  type SlidingWindowLimit,
  type SlidingWindowStore,
} from '../../lib/sliding-window.js';
import type { BansRepository } from './bans.js';

export interface OtpGuardOptions {
  hasher: IdentifierHasher;
  bans: BansRepository;
  store: SlidingWindowStore;
  now?: () => number;
}

// Key namespace reserved for OTP counters (other buckets use different prefixes).
const NS = 'otpguard';

export const BANNED_MESSAGE =
  'Flatrimony can’t send a code here. If you think this is a mistake, contact support.';

export function waitMessage(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1
    ? 'Too many attempts. Try again in a minute.'
    : `Too many attempts. Try again in ${minutes} minutes.`;
}

export const otpGuardRoutes: FastifyPluginAsyncZod<OtpGuardOptions> = async (app, opts) => {
  const now = opts.now ?? Date.now;

  app.post(
    '/auth/otp-guard',
    { schema: { body: OtpGuardRequest, response: { 200: OtpGuardResponse } } },
    async (req, reply) => {
      const t = now();
      const phoneHash = opts.hasher('phone', req.body.phone);
      const deviceHash = opts.hasher('device', req.body.deviceId);

      const buckets: [string, SlidingWindowLimit][] = [
        [`${NS}:ip:${ipKey(req.ip)}`, OTP_LIMITS.perIp],
        [`${NS}:device:${deviceHash.toString('hex')}`, OTP_LIMITS.perDevice],
        [`${NS}:phone:${phoneHash.toString('hex')}`, OTP_LIMITS.perPhone],
      ];
      for (const [key, limit] of buckets) {
        const wait = opts.store.peek(key, limit, t);
        if (wait > 0) {
          reply.header('retry-after', wait);
          throw new ApiError('auth.otp_rate_limited', {
            title: 'Too many OTP requests',
            detail: waitMessage(wait),
            retryAfterSeconds: wait,
          });
        }
      }
      for (const [key, limit] of buckets) opts.store.record(key, limit, t);

      if (await opts.bans.isBanned({ phoneHash, deviceHash })) {
        req.log.info({ ban: true }, 'otp-guard: banned identity');
        throw new ApiError('auth.banned', { title: 'Not allowed', detail: BANNED_MESSAGE });
      }
      return { allowed: true as const };
    },
  );
};

export type OtpGateDecision = { ok: true } | { ok: false };

export interface SendSmsGate {
  /** May an OTP be sent to this phone now? Same answer for "banned" and "over the limit". */
  check(phone: string): Promise<OtpGateDecision>;
  /** Counts a successful send (only then: a failed provider call must not use up the quota). */
  recordSent(phone: string): void;
}

/**
 * Server-side enforcement used by the Send SMS hook (cannot be bypassed by skipping otp-guard):
 * banned phones get no OTP, and at most 5 OTPs are SENT per phone per 15 minutes. The limit is
 * checked before the ban so the hook is not a free ban oracle either.
 */
export function createSendSmsGate(opts: {
  hasher: IdentifierHasher;
  bans: BansRepository;
  store: SlidingWindowStore;
  now?: () => number;
}): SendSmsGate {
  const now = opts.now ?? Date.now;
  const key = (phone: string) => `${NS}:sent:${opts.hasher('phone', phone).toString('hex')}`;
  return {
    async check(phone) {
      if (opts.store.peek(key(phone), OTP_LIMITS.perPhone, now()) > 0) return { ok: false };
      if (await opts.bans.isBanned({ phoneHash: opts.hasher('phone', phone) }))
        return { ok: false };
      return { ok: true };
    },
    recordSent(phone) {
      opts.store.record(key(phone), OTP_LIMITS.perPhone, now());
    },
  };
}
