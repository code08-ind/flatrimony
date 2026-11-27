/**
 * DigiLocker verification on the client (FR-VER-01, 07; docs/06 §8.8; designs M17/M18): waiting
 * for the result and what each outcome tells the user. Pure, unit-tested; the screens call it.
 */
import type { MessageKey } from '@flatrimony/i18n';
import type { Verification, VerificationFailureCode } from '@flatrimony/shared';

/** What the app shows once the attempt is no longer pending (or it stopped waiting). */
export type VerifyOutcome =
  | { kind: 'verified' }
  | { kind: 'failed'; code: VerificationFailureCode }
  | { kind: 'expired' }
  /** Still pending after the wait: DigiLocker is slow, or the user has not finished there. */
  | { kind: 'timeout' }
  /** The status could not be read (offline, server error). */
  | { kind: 'error' };

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 60_000;

export function outcomeOf(
  v: Verification,
): Exclude<VerifyOutcome, { kind: 'error' | 'timeout' }> | null {
  switch (v.status) {
    case 'verified':
      return { kind: 'verified' };
    case 'expired':
      return { kind: 'expired' };
    case 'failed':
      return { kind: 'failed', code: v.failureCode ?? 'provider_error' };
    default:
      return null; // pending
  }
}

/**
 * Asks for the attempt every `intervalMs` until it is decided, `timeoutMs` passes, or `stopped()`
 * says the screen went away. A failed read is retried; three in a row end the wait as 'error'.
 */
export async function pollVerification(
  fetchStatus: () => Promise<Verification | null>,
  {
    intervalMs = POLL_INTERVAL_MS,
    timeoutMs = POLL_TIMEOUT_MS,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    stopped = () => false,
  }: {
    intervalMs?: number;
    timeoutMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    stopped?: () => boolean;
  } = {},
): Promise<VerifyOutcome | null> {
  const until = now() + timeoutMs;
  let failures = 0;
  for (;;) {
    if (stopped()) return null;
    let v: Verification | null = null;
    try {
      v = await fetchStatus();
      failures = 0;
    } catch {
      failures++;
      if (failures >= 3) return { kind: 'error' };
    }
    if (stopped()) return null;
    const done = v && outcomeOf(v);
    if (done) return done;
    if (now() + intervalMs > until) return { kind: 'timeout' };
    await sleep(intervalMs);
  }
}

/** Outcomes a new attempt cannot change: shown again whenever the verify screen opens. */
const FINAL = new Set<VerificationFailureCode>(['underage', 'identity_in_use', 'banned']);

/**
 * DigiLocker gives names in English letters, so a display name without a word of at least two
 * (typed in Devanagari, or a single initial) can never match it (docs/07 T3.1 founder decision 1).
 */
export const hasLatinLetter = (name: string) => /[A-Za-z]{2,}/.test(name);

/** How long a finished attempt is still shown when the verify screen opens again. */
export const RESUME_WINDOW_MS = 15 * 60_000;

/**
 * Opening the verify screen again (the app came back, or Android closed it while the user was in
 * DigiLocker): the newest DigiLocker attempt says where to pick up. 'wait' for an unfinished one,
 * the outcome of one that ended in the last 15 minutes, or null for the gate.
 */
export function resumeFrom(
  attempts: readonly Verification[],
  now: number,
): { wait: string } | { outcome: Exclude<VerifyOutcome, { kind: 'error' }>; id: string } | null {
  const latest = attempts.find((a) => a.type === 'digilocker');
  if (!latest) return null;
  if (latest.status === 'pending') return { wait: latest.id };
  const outcome = outcomeOf(latest);
  if (!outcome) return null;
  // What a new attempt cannot change stays on screen (each start is a paid provider session).
  if (outcome.kind === 'failed' && FINAL.has(outcome.code)) return { outcome, id: latest.id };
  const ended = Date.parse(latest.completedAt ?? latest.expiresAt ?? latest.startedAt);
  if (Number.isNaN(ended) || now - ended > RESUME_WINDOW_MS) return null;
  return { outcome, id: latest.id };
}

/** What to say about an outcome, and what the user can do next. */
export interface OutcomeCopy {
  title: MessageKey;
  body: MessageKey;
  /** edit_name: fix the display name and try again; retry: start again; check: ask again. */
  action: 'done' | 'edit_name' | 'retry' | 'check' | 'none';
}

export function outcomeCopy(outcome: Exclude<VerifyOutcome, { kind: 'error' }>): OutcomeCopy {
  switch (outcome.kind) {
    case 'verified':
      return {
        title: 'verification.verified.title',
        body: 'verification.verified.body',
        action: 'done',
      };
    case 'expired':
      return {
        title: 'verification.expired.title',
        body: 'verification.expired.body',
        action: 'retry',
      };
    case 'timeout':
      return {
        title: 'verification.timeout.title',
        body: 'verification.timeout.body',
        action: 'check',
      };
    case 'failed':
      switch (outcome.code) {
        case 'name_mismatch':
          return {
            title: 'verification.failed.nameMismatch.title',
            body: 'verification.failed.nameMismatch.body',
            action: 'edit_name',
          };
        case 'underage':
          return {
            title: 'verification.failed.underage.title',
            body: 'verification.failed.underage.body',
            action: 'none',
          };
        case 'identity_in_use':
          return {
            title: 'verification.failed.identityInUse.title',
            body: 'verification.failed.identityInUse.body',
            action: 'none',
          };
        case 'banned':
          return {
            title: 'verification.failed.banned.title',
            body: 'verification.failed.banned.body',
            action: 'none',
          };
        case 'user_cancelled':
          return {
            title: 'verification.failed.cancelled.title',
            body: 'verification.failed.cancelled.body',
            action: 'retry',
          };
        case 'provider_error':
          return {
            title: 'verification.failed.providerError.title',
            body: 'verification.failed.providerError.body',
            action: 'retry',
          };
        // Work/college email only (T3.3); never a DigiLocker outcome.
        case 'email_in_use':
          return {
            title: 'verification.email.inUse.title',
            body: 'verification.email.inUse.body',
            action: 'none',
          };
      }
  }
}

/** The message for a refused start (docs/05 §8.4 codes). */
export function startErrorKey(status: number | 'network', code?: string): MessageKey {
  if (status === 'network') return 'verification.errors.network';
  if (status === 409 && code === 'conflict') return 'verification.errors.inProgress';
  if (status === 429) return 'verification.errors.tooMany';
  if (status === 503) return 'verification.errors.notOpen';
  return 'verification.errors.generic';
}
