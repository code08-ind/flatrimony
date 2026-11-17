/** OTP resend timer (docs/06 §8.2: 30 s). */
export const RESEND_SECONDS = 30;

/** Seconds left until resend is allowed, never negative. */
export function secondsLeft(sentAtMs: number, nowMs: number, waitSeconds = RESEND_SECONDS): number {
  return Math.max(0, Math.ceil((sentAtMs + waitSeconds * 1000 - nowMs) / 1000));
}

/** 23 → "0:23", 75 → "1:15". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
