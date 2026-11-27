import { z } from 'zod';
import { VerificationStatus, VerificationType } from '../enums.js';
import { IsoDateTime, Uuid } from '../primitives.js';
import { PolicyVersion } from './me.js';

/**
 * Why a verification failed (docs/05 §8.4; the database's verifications_failure_code_values_chk).
 * `expired` is a status of its own, not a failure code.
 */
export const VerificationFailureCode = z.enum([
  'name_mismatch',
  'underage',
  'identity_in_use',
  'banned',
  'provider_error',
  'user_cancelled',
  /** Work/college email: the address is already confirmed by another account (T3.3). */
  'email_in_use',
]);
export type VerificationFailureCode = z.infer<typeof VerificationFailureCode>;

/**
 * `POST /v1/verifications/digilocker` (FR-VER-01). The user agrees to identity verification (the
 * current `identity_verification` policy version, recorded as a consent; DigiLocker and provider
 * terms require explicit consent) and gets the provider's page to open.
 */
export const StartDigiLockerRequest = z.object({ consentVersion: PolicyVersion }).strict();
export type StartDigiLockerRequest = z.infer<typeof StartDigiLockerRequest>;

export const StartDigiLockerResponse = z.object({
  verificationId: Uuid,
  redirectUrl: z.url({ protocol: /^https?$/ }),
  expiresAt: IsoDateTime,
});
export type StartDigiLockerResponse = z.infer<typeof StartDigiLockerResponse>;

/** One verification attempt as its owner sees it (no identity data, ever: FR-VER-02). */
export const Verification = z.object({
  id: Uuid,
  type: VerificationType,
  status: VerificationStatus,
  failureCode: VerificationFailureCode.nullable(),
  startedAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
});
export type Verification = z.infer<typeof Verification>;

/** `GET /v1/verifications`: the caller's attempts, newest first. */
export const VerificationList = z.object({ verifications: z.array(Verification) });
export type VerificationList = z.infer<typeof VerificationList>;

/** Work or college email verification (FR-VER-05, T3.3). */
export const EmailVerificationType = z.enum(['work_email', 'college_email']);
export type EmailVerificationType = z.infer<typeof EmailVerificationType>;

/**
 * `POST /v1/verifications/email`: send a one-time link to a work or college address. The address
 * is never stored (only its domain and an HMAC); the link is valid for 24 hours.
 */
export const StartEmailVerificationRequest = z
  .object({ email: z.string().trim().min(3).max(254), type: EmailVerificationType })
  .strict();
export type StartEmailVerificationRequest = z.infer<typeof StartEmailVerificationRequest>;

export const StartEmailVerificationResponse = z.object({
  verificationId: Uuid,
  expiresAt: IsoDateTime,
});
export type StartEmailVerificationResponse = z.infer<typeof StartEmailVerificationResponse>;

/** The link's token: 32 random bytes, base64url (43 characters). */
export const EmailVerificationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** `POST /v1/verifications/email/confirm` (public: the link may be opened on any device). */
export const ConfirmEmailVerificationRequest = z.object({ token: EmailVerificationToken }).strict();
export type ConfirmEmailVerificationRequest = z.infer<typeof ConfirmEmailVerificationRequest>;

export const ConfirmEmailVerificationResponse = z.object({
  status: z.literal('verified'),
  type: EmailVerificationType,
});
export type ConfirmEmailVerificationResponse = z.infer<typeof ConfirmEmailVerificationResponse>;
