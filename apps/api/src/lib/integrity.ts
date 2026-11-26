/**
 * Play Integrity (FR-LST-05; docs/03 §14 Mobile): the Android app asks Google for a token bound to
 * a request hash (here the walkthrough video's SHA-256), and the API decodes it to learn whether
 * the app and device are genuine. Only the verdict is stored, never the token.
 *
 * The real verifier needs the Play Console project and a Google service account (Blocked, docs/07
 * T3.6). Until then `mock` decodes `mock.<base64url JSON>` tokens that tests and local runs make with
 * `mockIntegrityToken`; production refuses the mock (env.ts).
 */
import { createHash } from 'node:crypto';

/**
 * The request hash a walkthrough's integrity token must be issued for: SHA-256 (lower-case hex) of
 * `<storageKey>:<file SHA-256 hex>`. The storage key names the listing and this one upload, so a
 * token cannot be replayed for the same file on another listing or another upload (the Android
 * app computes the same value before asking Google for the token; T3.7).
 */
export function walkthroughRequestHash(storageKey: string, fileSha256Hex: string): string {
  return createHash('sha256').update(`${storageKey}:${fileSha256Hex}`).digest('hex');
}

export type IntegrityVerdict =
  | 'meets_device_integrity'
  | 'meets_basic_integrity'
  /** The token was valid but neither the app nor the device passed. */
  | 'failed';

export class IntegrityUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityUnavailable';
  }
}

export interface IntegrityVerifier {
  readonly name: string;
  /**
   * The verdict of a token issued for `requestHash` (lower-case hex), or null when the token is not
   * a valid token for that request (forged, expired, another file, another app).
   */
  verify(token: string, requestHash: string): Promise<IntegrityVerdict | null>;
}

interface MockClaims {
  verdict: IntegrityVerdict;
  requestHash: string;
  /** Seconds since epoch; tokens older than 10 minutes are refused (as Google's guidance). */
  issuedAt: number;
}

const MAX_AGE_S = 10 * 60;

export function mockIntegrityVerifier(now: () => number = Date.now): IntegrityVerifier {
  return {
    name: 'mock',
    async verify(token, requestHash) {
      if (!token.startsWith('mock.')) return null;
      let claims: Partial<MockClaims>;
      try {
        claims = JSON.parse(Buffer.from(token.slice(5), 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      const verdicts: IntegrityVerdict[] = [
        'meets_device_integrity',
        'meets_basic_integrity',
        'failed',
      ];
      if (!claims.verdict || !verdicts.includes(claims.verdict)) return null;
      if (claims.requestHash !== requestHash) return null;
      const age = now() / 1000 - Number(claims.issuedAt);
      if (!Number.isFinite(age) || age < -60 || age > MAX_AGE_S) return null;
      return claims.verdict;
    },
  };
}

/** A token the mock accepts (tests, local QA; the Android app makes real ones). */
export function mockIntegrityToken(
  requestHash: string,
  verdict: IntegrityVerdict = 'meets_device_integrity',
  issuedAt = Math.floor(Date.now() / 1000),
): string {
  const claims: MockClaims = { verdict, requestHash, issuedAt };
  return `mock.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
}
