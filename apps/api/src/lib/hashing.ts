/**
 * Lookup hashes for identifiers we must match but never store raw (docs/04 §13):
 * HMAC-SHA-256(HASH_PEPPER, value). Used for phone numbers, device installation ids and
 * DigiLocker ids (bans, uniqueness). The pepper lives in Secret Manager, outside the database.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { normaliseIndianMobile } from './phone.js';

export type IdentifierHasher = (kind: 'phone' | 'device' | 'digilocker', value: string) => Buffer;

export function createIdentifierHasher(pepper: string): IdentifierHasher {
  if (pepper.length < 32) throw new Error('HASH_PEPPER must be at least 32 characters');
  // The kind is part of the input so the same string never hashes alike across kinds. Phones are
  // canonicalised first ('91…' and '+91…' are the same number), or bans would silently miss.
  return (kind, value) => {
    let input = value;
    if (kind === 'phone') {
      const canonical = normaliseIndianMobile(value);
      if (!canonical) throw new Error('Not an Indian mobile number');
      input = canonical;
    } else if (kind === 'digilocker') {
      // One identity, one hash, however a provider formats the id (case, width, spaces): the
      // one-account rule and DigiLocker bans depend on it (T3.1 review).
      input = value.normalize('NFKC').trim().toLowerCase();
    }
    return createHmac('sha256', pepper).update(`${kind}:`).update(input).digest();
  };
}

/** Local development only: a throwaway pepper (bans by hash do not survive a restart). */
export function ephemeralPepper(): string {
  return randomBytes(32).toString('base64');
}
