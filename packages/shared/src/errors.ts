/** Error code catalogue (docs/05 §13) and RFC 9457 Problem Details (docs/05 §4). */
import { z } from 'zod';

export const ERROR_CATALOGUE = {
  'auth.unauthenticated': 401,
  'auth.account_deleted': 401,
  'auth.banned': 403,
  'auth.otp_rate_limited': 429,
  'auth.recent_login_required': 403,
  'account.suspended': 403,
  'profile.underage': 422,
  'profile.incomplete': 409,
  'profile.category_not_allowed': 403,
  'verification.required': 403,
  'verification.other_party_pending': 403,
  'verification.failed': 422,
  'verification.identity_in_use': 409,
  'listing.not_allowed_for_intent': 403,
  'listing.incomplete': 409,
  'listing.video_invalid': 422,
  'listing.brokerage_not_allowed': 422,
  'integrity.failed': 403,
  'swipe.already_swiped': 409,
  'swipe.daily_limit_reached': 403,
  'match.closed': 409,
  'match.decision_not_open': 409,
  'message.too_long': 422,
  'message.new_conversation_limit': 429,
  'meetup.invalid_time': 422,
  'meetup.active_exists': 409,
  'safety.contacts_required': 409,
  'entitlement.required': 403,
  'payment.provider_error': 502,
  'idempotency.key_reused': 409,
  limit_exceeded: 409,
  rate_limited: 429,
  'validation.failed': 422,
  not_found: 404,
  conflict: 409,
  internal: 500,
  // Transport-level codes used by the API framework (docs/05 §4 status table).
  bad_request: 400,
  'precondition.failed': 412,
  payload_too_large: 413,
  'upstream.unavailable': 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;
export const ERROR_CODES = Object.keys(ERROR_CATALOGUE) as ErrorCode[];
export const ErrorCodeSchema = z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]);

export function statusFor(code: ErrorCode): number {
  return ERROR_CATALOGUE[code];
}

export const ERROR_TYPE_BASE = 'https://docs.flatrimony.in/errors/';

export const FieldError = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof FieldError>;

export const ProblemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: ErrorCodeSchema,
  detail: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(FieldError).optional(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  suspendedUntil: z.iso.datetime().optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

export function problem(
  code: ErrorCode,
  init: Omit<ProblemDetails, 'type' | 'status' | 'code' | 'title'> & { title?: string } = {},
): ProblemDetails {
  const { title, ...rest } = init;
  return {
    type: `${ERROR_TYPE_BASE}${code}`,
    title: title ?? code,
    status: statusFor(code),
    code,
    ...rest,
  };
}
