import type { MessageKey } from '@flatrimony/i18n';
import type { RequestOtpResult, VerifyOtpResult } from './otp-flow';

type RequestReason = Exclude<Extract<RequestOtpResult, { ok: false }>['reason'], 'rate_limited'>;
type VerifyReason = Extract<VerifyOtpResult, { ok: false }>['reason'];

/** Translation key for each failure (the rate-limit message needs minutes and is built separately). */
export function requestErrorKey(reason: RequestReason): MessageKey {
  switch (reason) {
    case 'resend_too_soon':
      return 'auth.errors.resendTooSoon';
    case 'too_many_requests':
      return 'auth.errors.tooManyRequests';
    case 'banned':
      return 'auth.errors.banned';
    case 'invalid_number':
      return 'auth.phone.invalid';
    case 'network':
      return 'auth.errors.network';
    case 'unavailable':
      return 'auth.errors.unavailable';
  }
}

export function verifyErrorKey(reason: VerifyReason): MessageKey {
  switch (reason) {
    case 'wrong_or_expired_code':
      return 'auth.otp.wrongCode';
    case 'too_many_attempts':
      return 'auth.otp.tooManyAttempts';
    case 'network':
      return 'auth.errors.network';
    case 'unavailable':
      return 'auth.errors.unavailable';
  }
}
