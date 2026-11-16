/**
 * Supabase Auth "Send SMS" HTTP hook (T2.2, FR-AUTH-01; docs/05 §8.22).
 *
 * Supabase Auth calls this once per OTP SMS with `{ user, sms: { otp } }`, signed with Standard
 * Webhooks. We verify the signature against the RAW body bytes, reject stale deliveries, dedupe by
 * `webhook-id`, accept only Indian mobile numbers, and hand the OTP to the SMS provider.
 *
 * Response contract (Supabase auth hooks): 200 `{}` on success; otherwise
 * `{ "error": { "http_code", "message" } }` with Content-Type application/json. 429/503 are
 * retried by Auth when `retry-after` is present; 400/403 surface to the client as 500. Auth gives
 * the whole hook (including retries) 5 seconds, so the provider call is aborted after 2 s.
 *
 * This plugin must stay encapsulated (no fastify-plugin wrapper): its raw-body JSON parser would
 * otherwise apply to every route. Never logs the phone number or the OTP.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyWebhook } from '../../lib/standard-webhooks.js';
import type { MockSmsProvider, SmsProvider } from '../../lib/sms.js';

// Supabase sends a 6-digit OTP (Auth's SMS OTP length, default 6). If that setting ever changes,
// change this pattern with it, or every hook call fails and nobody can sign in.
const Payload = z.object({
  user: z
    .object({
      id: z.uuid(),
      phone: z.string(),
    })
    .loose(),
  sms: z
    .object({
      otp: z.string().regex(/^\d{6}$/),
      // The number the code must go to. Observed (Supabase Auth, local CLI, Nov 2026): for a
      // phone-number change this is the NEW number while user.phone is still the old one.
      // Not in Supabase's documented schema, so fall back to user.phone when absent.
      phone: z.string().optional(),
    })
    .loose(),
});

/** Supabase stores E.164 with or without '+'; we accept Indian mobile numbers only. */
export function normaliseIndianMobile(phone: string): string | null {
  const digits = phone.replace(/^\+/, '');
  return /^91[6-9]\d{9}$/.test(digits) ? `+${digits}` : null;
}

export interface SendSmsHookOptions {
  keys: readonly Buffer[];
  provider: SmsProvider;
  nowSeconds?: () => number;
  /** Abort the provider call after this long (leaves room for one Auth retry within 5 s). */
  providerTimeoutMs?: number;
  /** Failed signature checks allowed per IP per minute before answering 429 without verifying. */
  maxFailuresPerMinute?: number;
}

const REPLAY_WINDOW_SECONDS = 600; // > 2 × the 5-minute timestamp tolerance

function hookError(reply: FastifyReply, httpCode: number, message: string, retry = false) {
  if (retry) reply.header('retry-after', '1');
  return reply
    .code(httpCode)
    .type('application/json')
    .send({ error: { http_code: httpCode, message } });
}

export async function sendSmsHookRoutes(app: FastifyInstance, opts: SendSmsHookOptions) {
  const nowSeconds = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const timeoutMs = opts.providerTimeoutMs ?? 2_000;
  const maxFailures = opts.maxFailuresPerMinute ?? 30;

  // webhook-id → state. 'in_flight' blocks a concurrent duplicate; 'done' makes a replay a no-op.
  // Per instance; cross-instance dedupe needs private.idempotency_keys (migration 0012).
  const deliveries = new Map<string, { state: 'in_flight' | 'done'; at: number }>();
  // Failed signature checks per IP per minute: bounds HMAC work and log volume from forgers.
  const failures = new Map<string, { count: number; minute: number }>();

  // Keep the exact bytes for signature verification (re-serialising JSON would break it).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 20 * 1024 },
    (_req, body, done) => {
      done(null, body);
    },
  );

  function tooManyFailures(req: FastifyRequest, now: number): boolean {
    const minute = Math.floor(now / 60);
    const entry = failures.get(req.ip);
    return !!entry && entry.minute === minute && entry.count >= maxFailures;
  }

  function recordFailure(req: FastifyRequest, now: number, reason: string) {
    const minute = Math.floor(now / 60);
    const entry = failures.get(req.ip);
    const count = entry && entry.minute === minute ? entry.count + 1 : 1;
    failures.set(req.ip, { count, minute });
    if (failures.size > 10_000) failures.clear();
    // Log the first failure per IP per minute, then stay quiet until the next minute.
    if (count === 1) req.log.warn({ reason }, 'send-sms hook rejected');
  }

  // Every error in this plugin (oversized body, bad content type, …) answers in the hook format.
  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error({ error: (err as Error).name }, 'send-sms hook error');
    const message =
      status === 413
        ? 'Payload too large'
        : status === 415
          ? 'Content-Type must be application/json'
          : 'Bad request';
    return hookError(reply, status, message);
  });

  app.post(
    '/webhooks/auth/send-sms',
    { config: { rateLimit: false }, bodyLimit: 20 * 1024 },
    async (req, reply) => {
      const now = nowSeconds();
      // Auth always sends JSON; any other type would bypass the raw-JSON parser above.
      if (
        !Buffer.isBuffer(req.body) ||
        !/^application\/json\b/i.test(req.headers['content-type'] ?? '')
      ) {
        return hookError(reply, 415, 'Content-Type must be application/json');
      }
      if (tooManyFailures(req, now)) return hookError(reply, 429, 'Too many invalid requests');

      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const verdict = verifyWebhook(req.headers, raw, opts.keys, now);
      if (!verdict.ok) {
        recordFailure(req, now, verdict.reason);
        return hookError(reply, 401, 'Invalid webhook signature');
      }

      for (const [id, d] of deliveries)
        if (now - d.at > REPLAY_WINDOW_SECONDS) deliveries.delete(id);
      const previous = deliveries.get(verdict.id);
      if (previous?.state === 'done') return reply.code(200).type('application/json').send({});
      if (previous?.state === 'in_flight')
        return hookError(reply, 503, 'Delivery already in progress', true);

      let payload: z.infer<typeof Payload>;
      try {
        payload = Payload.parse(JSON.parse(raw.toString('utf8')));
      } catch {
        return hookError(reply, 400, 'Malformed hook payload');
      }

      const target = payload.sms.phone || payload.user.phone;
      const phone = normaliseIndianMobile(target);
      if (!phone) {
        req.log.info({ userId: payload.user.id }, 'send-sms hook: non-Indian number refused');
        return hookError(reply, 400, 'Only Indian mobile numbers are supported');
      }

      deliveries.set(verdict.id, { state: 'in_flight', at: now });
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(new Error('sms_provider_timeout')), timeoutMs);
      try {
        await Promise.race([
          opts.provider.sendOtp({ phone, otp: payload.sms.otp }, abort.signal),
          new Promise<never>((_resolve, reject) => {
            abort.signal.addEventListener('abort', () => reject(abort.signal.reason), {
              once: true,
            });
          }),
        ]);
      } catch (err) {
        deliveries.delete(verdict.id); // Auth's retry may send again
        // err.name only: provider messages can echo the destination number.
        req.log.error(
          { userId: payload.user.id, provider: opts.provider.name, error: (err as Error).name },
          'OTP SMS failed',
        );
        return hookError(reply, 503, 'SMS provider unavailable', true);
      } finally {
        clearTimeout(timer);
      }

      deliveries.set(verdict.id, { state: 'done', at: now });
      req.log.info(
        { userId: payload.user.id, provider: opts.provider.name, webhookId: verdict.id },
        'OTP SMS sent',
      );
      return reply.code(200).type('application/json').send({});
    },
  );
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Local-only helper so developers and E2E tests can read the OTP the mock "sent".
 * Registered only when APP_ENV=local with the mock provider (see app.ts), and answers only to
 * loopback connections (the dev server binds 0.0.0.0, so the LAN could otherwise reach it). Uses
 * the socket address, not req.ip, which proxies can influence. The phone goes in the body.
 */
export async function devSmsOutboxRoutes(
  app: FastifyInstance,
  opts: { provider: MockSmsProvider },
) {
  const Body = z.object({ phone: z.string() });
  app.post('/dev/sms-outbox/latest', async (req, reply) => {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply.code(404).send({ otp: null });
    const parsed = Body.safeParse(req.body);
    const phone = parsed.success ? normaliseIndianMobile(parsed.data.phone) : null;
    const otp = phone ? opts.provider.latest(phone) : undefined;
    if (!otp) return reply.code(404).send({ otp: null });
    return { otp };
  });
}
