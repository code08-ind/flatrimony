/**
 * Application-level encryption for the few fields that must be readable later but never in clear
 * in the database (docs/04 §13): the DigiLocker verified name, later listing addresses and trusted
 * contacts' numbers. AES-256-GCM; stored as version(1 byte) ‖ iv(12) ‖ ciphertext ‖ tag(16), which
 * the database checks (identity_records_name_enc_chk). The key comes from FIELD_ENCRYPTION_KEY
 * (`v1:<base64 of 32 bytes>`, Secret Manager); the version byte lets a later key replace it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * `context` is authenticated but not stored (AES-GCM additional data): pass the row's owner, so a
 * value copied to another row fails to decrypt instead of passing as that user's.
 */
export interface FieldCipher {
  encrypt(plaintext: string, context?: string): Buffer;
  decrypt(stored: Buffer, context?: string): string;
}

/** Parses `v1:<base64>`; throws on anything else (fail at startup, never at the first write). */
export function parseFieldKey(raw: string): Buffer {
  const m = /^v1:([A-Za-z0-9+/]+={0,2})$/.exec(raw.trim());
  if (!m) throw new Error('FIELD_ENCRYPTION_KEY must look like v1:<base64 of 32 bytes>');
  const key = Buffer.from(m[1]!, 'base64');
  if (key.toString('base64') !== m[1] || key.length !== 32)
    throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64');
  return key;
}

export function createFieldCipher(key: Buffer): FieldCipher {
  if (key.length !== 32) throw new Error('A field encryption key is 32 bytes');
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      if (context !== undefined) cipher.setAAD(Buffer.from(context, 'utf8'));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]);
    },
    decrypt(stored, context) {
      if (stored.length < 1 + IV_BYTES + TAG_BYTES || stored[0] !== VERSION)
        throw new Error('Unknown field encryption format');
      const iv = stored.subarray(1, 1 + IV_BYTES);
      const tag = stored.subarray(stored.length - TAG_BYTES);
      const body = stored.subarray(1 + IV_BYTES, stored.length - TAG_BYTES);
      // The full 16-byte tag only: a shorter one would weaken the authentication.
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      if (context !== undefined) decipher.setAAD(Buffer.from(context, 'utf8'));
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    },
  };
}

/** Local development only: a throwaway key (encrypted values do not survive a restart). */
export function ephemeralFieldKey(): Buffer {
  return randomBytes(32);
}
