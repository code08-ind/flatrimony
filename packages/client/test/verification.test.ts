import { describe, expect, it } from 'vitest';
import type { Verification } from '@flatrimony/shared';
import { messages } from '@flatrimony/i18n';
import {
  hasLatinLetter,
  outcomeCopy,
  outcomeOf,
  pollVerification,
  RESUME_WINDOW_MS,
  resumeFrom,
  startErrorKey,
} from '../src/index.js';

const T0 = Date.parse('2026-11-25T10:00:00Z');
const attempt = (over: Partial<Verification> = {}): Verification => ({
  id: '00000000-0000-4000-8000-000000000001',
  type: 'digilocker',
  status: 'pending',
  failureCode: null,
  startedAt: new Date(T0).toISOString(),
  completedAt: null,
  expiresAt: new Date(T0 + 10 * 60_000).toISOString(),
  ...over,
});

/** A fake clock: sleeping moves time forward. */
function clock() {
  let now = T0;
  return { now: () => now, sleep: async (ms: number) => void (now += ms) };
}

describe('waiting for the result', () => {
  it('asks every 2 s until the attempt is decided', async () => {
    const c = clock();
    const answers = [
      attempt(),
      attempt(),
      attempt({ status: 'verified', completedAt: new Date(T0).toISOString() }),
    ];
    let calls = 0;
    const outcome = await pollVerification(async () => answers[calls++]!, c);
    expect(outcome).toEqual({ kind: 'verified' });
    expect(calls).toBe(3);
    expect(c.now() - T0).toBe(4_000);
  });

  it('gives up after a minute (still pending): timeout', async () => {
    const c = clock();
    const outcome = await pollVerification(async () => attempt(), c);
    expect(outcome).toEqual({ kind: 'timeout' });
    expect(c.now() - T0).toBeLessThanOrEqual(60_000);
  });

  it('a failed read is retried; three in a row end the wait', async () => {
    const c = clock();
    let calls = 0;
    const flaky = await pollVerification(async () => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return attempt({ status: 'failed', failureCode: 'name_mismatch' });
    }, c);
    expect(flaky).toEqual({ kind: 'failed', code: 'name_mismatch' });
    const down = await pollVerification(async () => {
      throw new Error('offline');
    }, clock());
    expect(down).toEqual({ kind: 'error' });
  });

  it('stops quietly when the screen goes away', async () => {
    let stop = false;
    const c = clock();
    const outcome = await pollVerification(
      async () => {
        stop = true;
        return attempt();
      },
      { ...c, stopped: () => stop },
    );
    expect(outcome).toBeNull();
  });

  it('a failed attempt without a code counts as a provider error; expired is its own outcome', () => {
    expect(outcomeOf(attempt({ status: 'failed', failureCode: null }))).toEqual({
      kind: 'failed',
      code: 'provider_error',
    });
    expect(outcomeOf(attempt({ status: 'expired' }))).toEqual({ kind: 'expired' });
    expect(outcomeOf(attempt())).toBeNull();
  });
});

describe('opening the verify screen again', () => {
  it('waits on an unfinished attempt; shows one that ended recently; else the gate', () => {
    expect(resumeFrom([attempt()], T0)).toEqual({ wait: attempt().id });
    const failed = attempt({
      status: 'failed',
      failureCode: 'name_mismatch',
      completedAt: new Date(T0).toISOString(),
    });
    expect(resumeFrom([failed], T0 + 60_000)).toEqual({
      outcome: { kind: 'failed', code: 'name_mismatch' },
      id: failed.id,
    });
    expect(resumeFrom([failed], T0 + RESUME_WINDOW_MS + 1)).toBeNull();
    expect(resumeFrom([], T0)).toBeNull();
    // Lazily expired (no completedAt): its expiry is when it ended.
    const lapsed = attempt({ status: 'expired' });
    expect(resumeFrom([lapsed], T0 + 11 * 60_000)).toEqual({
      outcome: { kind: 'expired' },
      id: lapsed.id,
    });
    expect(resumeFrom([lapsed], T0 + 10 * 60_000 + RESUME_WINDOW_MS + 1)).toBeNull();
    // A recent success shows; outcomes a retry cannot change stay, however old.
    const ok = attempt({ status: 'verified', completedAt: new Date(T0).toISOString() });
    expect(resumeFrom([ok], T0 + 1_000)).toEqual({ outcome: { kind: 'verified' }, id: ok.id });
    for (const code of ['underage', 'identity_in_use', 'banned'] as const) {
      const final = attempt({
        status: 'failed',
        failureCode: code,
        completedAt: new Date(T0).toISOString(),
      });
      expect(resumeFrom([final], T0 + 30 * 24 * 3600_000)).toEqual({
        outcome: { kind: 'failed', code },
        id: final.id,
      });
    }
    // Only DigiLocker attempts, newest first as the API lists them.
    expect(resumeFrom([attempt({ type: 'work_email' })], T0)).toBeNull();
  });
});

describe('names DigiLocker can match', () => {
  it('need at least one English letter', () => {
    expect(hasLatinLetter('Meera')).toBe(true);
    expect(hasLatinLetter('मीरा')).toBe(false);
    expect(hasLatinLetter('मीरा Mi')).toBe(true);
    expect(hasLatinLetter('A')).toBe(false); // an initial never matches
  });
});

describe('what each outcome says', () => {
  const outcomes = [
    { kind: 'verified' },
    { kind: 'expired' },
    { kind: 'timeout' },
    ...(
      [
        'name_mismatch',
        'underage',
        'identity_in_use',
        'banned',
        'user_cancelled',
        'provider_error',
      ] as const
    ).map((code) => ({ kind: 'failed', code }) as const),
  ] as const;

  it('every outcome has its own title and an existing message in both languages', () => {
    const titles = new Set<string>();
    for (const o of outcomes) {
      const copy = outcomeCopy(o);
      titles.add(copy.title);
      for (const key of [copy.title, copy.body])
        for (const locale of ['en', 'hi'] as const) {
          const text = key
            .split('.')
            .reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], messages[locale]);
          expect(typeof text, `${locale}:${key}`).toBe('string');
        }
    }
    expect(titles.size).toBe(outcomes.length);
  });

  it('the next step fits the reason', () => {
    expect(outcomeCopy({ kind: 'failed', code: 'name_mismatch' }).action).toBe('edit_name');
    expect(outcomeCopy({ kind: 'failed', code: 'user_cancelled' }).action).toBe('retry');
    expect(outcomeCopy({ kind: 'failed', code: 'provider_error' }).action).toBe('retry');
    expect(outcomeCopy({ kind: 'expired' }).action).toBe('retry');
    expect(outcomeCopy({ kind: 'timeout' }).action).toBe('check');
    // No retry button for what a retry cannot fix.
    for (const code of ['underage', 'identity_in_use', 'banned'] as const)
      expect(outcomeCopy({ kind: 'failed', code }).action).toBe('none');
    expect(outcomeCopy({ kind: 'verified' }).action).toBe('done');
  });

  it('a refused start says why', () => {
    expect(startErrorKey('network')).toBe('verification.errors.network');
    expect(startErrorKey(409, 'conflict')).toBe('verification.errors.inProgress');
    expect(startErrorKey(429)).toBe('verification.errors.tooMany');
    expect(startErrorKey(503)).toBe('verification.errors.notOpen');
    expect(startErrorKey(500)).toBe('verification.errors.generic');
  });
});
