/**
 * SMS delivery for OTPs (FR-AUTH-01). The real provider needs DLT registration (sender ID and
 * template), which is a founder task (T0.6 / OQ-03), so only the mock exists for now. The mock is
 * refused in production at startup.
 *
 * Never log phone numbers or OTPs (docs/03 §13.1).
 */
export interface SmsProvider {
  readonly name: string;
  /**
   * Sends the OTP. Must honour `signal` (abort the HTTP call) so a timed-out send is not completed
   * after the hook has already told Auth to retry. Errors must not carry the phone number or OTP in
   * `name`; the hook logs only `err.name`.
   */
  sendOtp(message: { phone: string; otp: string }, signal?: AbortSignal): Promise<void>;
}

/** In-memory outbox for local development and tests. Keeps only the latest OTP per phone, briefly. */
export interface MockSmsProvider extends SmsProvider {
  latest(phone: string, nowMs?: number): string | undefined;
  readonly sentCount: number;
}

export function mockSmsProvider(
  opts: { ttlMs?: number; now?: () => number } = {},
): MockSmsProvider {
  const ttlMs = opts.ttlMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now;
  const outbox = new Map<string, { otp: string; at: number }>();
  let sentCount = 0;
  return {
    name: 'mock',
    async sendOtp({ phone, otp }, signal) {
      signal?.throwIfAborted();
      sentCount += 1;
      outbox.set(phone, { otp, at: now() });
      for (const [p, v] of outbox) if (now() - v.at > ttlMs) outbox.delete(p);
    },
    latest(phone, nowMs = now()) {
      const entry = outbox.get(phone);
      return entry && nowMs - entry.at <= ttlMs ? entry.otp : undefined;
    },
    get sentCount() {
      return sentCount;
    },
  };
}

export function isMockSmsProvider(p: SmsProvider): p is MockSmsProvider {
  return p.name === 'mock' && typeof (p as Partial<MockSmsProvider>).latest === 'function';
}

/** Picks the provider named by SMS_PROVIDER. Only the mock exists until DLT registration (T0.6). */
export function createSmsProvider(name: 'mock'): SmsProvider {
  switch (name) {
    case 'mock':
      return mockSmsProvider();
  }
}
