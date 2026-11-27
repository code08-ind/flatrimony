/**
 * Work and college email badges (FR-VER-05, T3.3), shared by the Android app (asking for a link)
 * and the web app (the page the link opens). The rules for addresses live in @flatrimony/shared,
 * so the app says "use your work email" before anything is sent.
 */
import type { MessageKey } from '@flatrimony/i18n';
import {
  emailProblem,
  type Badge,
  type EmailProblem,
  type EmailVerificationType,
  type Verification,
} from '@flatrimony/shared';

/** "Send again" waits this long after a link was sent (the API also caps requests). */
export const RESEND_AFTER_MS = 60_000;

const BADGE: Record<EmailVerificationType, Badge['type']> = {
  work_email: 'work_verified',
  college_email: 'student_verified',
};

export type EmailBadgeView =
  | { kind: 'verified' }
  /** A link is on its way and still works. */
  | { kind: 'sent'; verificationId: string; expiresAt: string }
  /** The newest attempt found the address on an account already. */
  | { kind: 'in_use' }
  | { kind: 'none' };

/** Where the member stands for one kind of email: from the profile's badges and their attempts. */
export function emailBadgeView(
  type: EmailVerificationType,
  badges: readonly Badge[],
  attempts: readonly Verification[],
  now: number,
): EmailBadgeView {
  if (badges.some((b) => b.type === BADGE[type])) return { kind: 'verified' };
  const latest = attempts.find((a) => a.type === type);
  if (!latest) return { kind: 'none' };
  if (latest.status === 'pending' && latest.expiresAt && Date.parse(latest.expiresAt) > now)
    return { kind: 'sent', verificationId: latest.id, expiresAt: latest.expiresAt };
  if (latest.status === 'failed' && latest.failureCode === 'email_in_use')
    return { kind: 'in_use' };
  return { kind: 'none' };
}

const PROBLEM_KEY: Record<EmailProblem, MessageKey> = {
  invalid_email: 'verification.email.errors.invalid',
  personal_domain: 'verification.email.errors.personal',
  disposable_domain: 'verification.email.errors.disposable',
  not_a_college_domain: 'verification.email.errors.notCollege',
};

/** What is wrong with the typed address (before sending), or null. */
export function emailFieldError(type: EmailVerificationType, text: string): MessageKey | null {
  const problem = emailProblem(type, text);
  return problem ? PROBLEM_KEY[problem] : null;
}

type ProblemBody = { code?: string; errors?: { code?: string }[] } | null | undefined;

/** The message for a refused `POST /verifications/email`. */
export function emailStartErrorKey(status: number | 'network', body?: unknown): MessageKey {
  if (status === 'network') return 'verification.errors.network';
  const b = body as ProblemBody;
  const reason = b?.errors?.[0]?.code;
  if (status === 422 && reason && reason in PROBLEM_KEY) return PROBLEM_KEY[reason as EmailProblem];
  if (status === 409 && b?.code === 'conflict') return 'verification.email.errors.already';
  if (status === 429)
    return reason === 'address_limited'
      ? 'verification.email.errors.addressLimit'
      : 'verification.email.errors.tooMany';
  if (status === 503) return 'verification.email.errors.sendFailed';
  return 'verification.errors.generic';
}

export type EmailConfirmResult =
  | { kind: 'verified'; type: EmailVerificationType }
  | { kind: 'expired' }
  | { kind: 'invalid' }
  | { kind: 'in_use' }
  /** Network, rate limit or server trouble: the same link may work on a retry. */
  | { kind: 'error' };

/** The answer of `POST /verifications/email/confirm`. */
export function emailConfirmResult(status: number | 'network', body?: unknown): EmailConfirmResult {
  if (status === 200) {
    const type = (body as { type?: string } | null)?.type;
    if (type === 'work_email' || type === 'college_email') return { kind: 'verified', type };
    return { kind: 'error' };
  }
  if (status === 422) {
    const reason = (body as ProblemBody)?.errors?.[0]?.code;
    if (reason === 'link_expired') return { kind: 'expired' };
    if (reason === 'email_in_use') return { kind: 'in_use' };
    // A malformed token (a link cut short by the mail app) is as good as an unknown one.
    return { kind: 'invalid' };
  }
  return { kind: 'error' };
}

/**
 * The token from the link's fragment (`#token=…`). A fragment never reaches a server, so the token
 * stays out of logs and Referer headers.
 */
export function tokenFromHash(hash: string): string | null {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash);
  return match?.[1] ?? null;
}
