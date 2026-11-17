import { secondsLeft } from './countdown';

/**
 * The number an OTP was just requested for, kept in memory only. Passing it as a route param would
 * put the phone number in the URL (and, on web, in browser history), which the privacy rules forbid.
 * Lost on app restart by design: the user simply enters the number again.
 */
export interface PendingSignIn {
  phone: string;
  sentAt: number;
}

let pending: PendingSignIn | null = null;

export const setPendingSignIn = (value: PendingSignIn | null) => {
  pending = value;
};
export const getPendingSignIn = (): PendingSignIn | null => pending;

/** True while the code already sent to this number can still be used and a resend is not allowed. */
export function codeStillFresh(value: PendingSignIn | null, phone: string, now: number): boolean {
  return value?.phone === phone && secondsLeft(value.sentAt, now) > 0;
}
