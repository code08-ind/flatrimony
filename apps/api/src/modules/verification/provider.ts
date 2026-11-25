/**
 * DigiLocker identity verification through a licensed provider (FR-VER-01; docs/05 §8.4). The
 * provider runs the DigiLocker consent (name, date of birth, gender) and tells us by webhook when
 * the user is done; we then fetch the result server-to-server and never trust the webhook body.
 *
 * Only a mock exists until the founder picks the provider (T0.7, OQ-02): it keeps sessions in
 * memory and serves a local consent page (modules/verification/dev-routes.ts) where a tester
 * enters the identity DigiLocker would return, or cancels.
 */
import { randomUUID } from 'node:crypto';
import type { VerifiedGender } from '@flatrimony/shared';

/** What DigiLocker shares with consent. Kept in memory only for the length of one request. */
export interface DigiLockerIdentity {
  /** Full name as on the documents. */
  name: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  gender: VerifiedGender;
  /** DigiLocker's stable user id (never an Aadhaar number); only its HMAC is stored. */
  digilockerId: string;
}

export type ProviderResult =
  | { state: 'pending' }
  | { state: 'consented'; identity: DigiLockerIdentity }
  | { state: 'failed'; reason: 'user_cancelled' | 'provider_error' };

export interface DigiLockerSession {
  /** The provider's transaction reference (never a document number). */
  providerRef: string;
  /** The page the app opens (Custom Tab / browser tab). */
  redirectUrl: string;
  expiresAt: Date;
}

export interface DigiLockerProvider {
  /** Stored in verifications.provider. */
  name: string;
  start(opts: { verificationId: string }): Promise<DigiLockerSession>;
  /** null when the provider does not know the reference. */
  result(providerRef: string): Promise<ProviderResult | null>;
}

/** The provider could not be reached or answered nonsense: try again later (503). */
export class DigiLockerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DigiLockerUnavailable';
  }
}

/**
 * A provider reference: opaque, URL-safe, no personal data, and no digits at all, so it can never
 * look like an Aadhaar number (the database refuses references with 12-digit runs, migration 0005).
 */
const REF = /^mock_[g-v-]{36}$/;
/** A UUID with its hex digits moved to letters g–v. */
export const mockRef = () =>
  `mock_${randomUUID().replace(/[0-9a-f]/g, (c) => String.fromCharCode(103 + parseInt(c, 16)))}`;

export interface MockDigiLocker extends DigiLockerProvider {
  /** The pending session for a reference (for the consent page), or null. */
  session(providerRef: string): { verificationId: string; expiresAt: Date; done: boolean } | null;
  /** What the tester chose on the consent page. */
  complete(
    providerRef: string,
    outcome: { identity: DigiLockerIdentity } | { cancelled: true },
  ): boolean;
}

export function mockDigiLockerProvider({
  publicApiUrl,
  ttlMs = 10 * 60_000,
  now = Date.now,
}: {
  publicApiUrl: string;
  ttlMs?: number;
  now?: () => number;
}): MockDigiLocker {
  const sessions = new Map<
    string,
    { verificationId: string; expiresAt: Date; result: ProviderResult }
  >();
  const base = publicApiUrl.replace(/\/+$/, '');
  return {
    name: 'mock_digilocker',
    async start({ verificationId }) {
      // Forget old sessions so the map cannot grow without bound in a long local run.
      for (const [ref, s] of sessions)
        if (s.expiresAt.getTime() < now() - ttlMs) sessions.delete(ref);
      const providerRef = mockRef();
      const expiresAt = new Date(now() + ttlMs);
      sessions.set(providerRef, { verificationId, expiresAt, result: { state: 'pending' } });
      return { providerRef, redirectUrl: `${base}/dev/digilocker/${providerRef}`, expiresAt };
    },
    async result(providerRef) {
      if (!REF.test(providerRef)) return null;
      return sessions.get(providerRef)?.result ?? null;
    },
    session(providerRef) {
      const s = REF.test(providerRef) ? sessions.get(providerRef) : undefined;
      return s
        ? {
            verificationId: s.verificationId,
            expiresAt: s.expiresAt,
            done: s.result.state !== 'pending',
          }
        : null;
    },
    complete(providerRef, outcome) {
      const s = REF.test(providerRef) ? sessions.get(providerRef) : undefined;
      if (!s || s.result.state !== 'pending') return false;
      s.result =
        'cancelled' in outcome
          ? { state: 'failed', reason: 'user_cancelled' }
          : { state: 'consented', identity: outcome.identity };
      return true;
    },
  };
}
