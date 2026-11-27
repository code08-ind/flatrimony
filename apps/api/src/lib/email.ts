/**
 * Transactional email (docs/03 §4: Resend or Amazon SES), used for work and college email links
 * (T3.3, FR-VER-05). No vendor account exists yet (Blocked in docs/07 T3.3), so only the mock
 * exists; it is refused in production at startup.
 *
 * Never log addresses, links or tokens (docs/03 §13.1).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  /**
   * Sends one message. Errors must not carry the address or the body in `message` or `name`: the
   * caller logs `err.name` only.
   */
  send(message: EmailMessage, signal?: AbortSignal): Promise<void>;
}

/** The provider could not take the message (try again later). */
export class EmailUnavailable extends Error {
  constructor() {
    super('email_unavailable');
    this.name = 'EmailUnavailable';
  }
}

/** In-memory outbox for local development and tests: the latest message per address, briefly. */
export interface MockEmailProvider extends EmailProvider {
  latest(to: string, nowMs?: number): EmailMessage | undefined;
  readonly sentCount: number;
}

export function mockEmailProvider(
  opts: { ttlMs?: number; now?: () => number; fail?: () => boolean } = {},
): MockEmailProvider {
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60_000;
  const now = opts.now ?? Date.now;
  const outbox = new Map<string, { message: EmailMessage; at: number }>();
  let sentCount = 0;
  const key = (to: string) => to.trim().toLowerCase();
  return {
    name: 'mock',
    async send(message, signal) {
      signal?.throwIfAborted();
      if (opts.fail?.()) throw new EmailUnavailable();
      sentCount += 1;
      for (const [k, v] of outbox) if (now() - v.at > ttlMs) outbox.delete(k);
      outbox.set(key(message.to), { message, at: now() });
    },
    latest(to, nowMs = now()) {
      const entry = outbox.get(key(to));
      return entry && nowMs - entry.at <= ttlMs ? entry.message : undefined;
    },
    get sentCount() {
      return sentCount;
    },
  };
}

export function isMockEmailProvider(p: EmailProvider): p is MockEmailProvider {
  return p.name === 'mock' && typeof (p as Partial<MockEmailProvider>).latest === 'function';
}

/** Picks the provider named by EMAIL_PROVIDER. Only the mock exists until a vendor is chosen. */
export function createEmailProvider(name: 'mock'): EmailProvider {
  switch (name) {
    case 'mock':
      return mockEmailProvider();
  }
}
