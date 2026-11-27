import { describe, expect, it } from 'vitest';
import type { Verification } from '@flatrimony/shared';
import {
  emailBadgeView,
  emailConfirmResult,
  emailFieldError,
  emailStartErrorKey,
  tokenFromHash,
} from '../src/email-verification.js';

const NOW = Date.parse('2026-11-27T06:00:00Z');
const attempt = (over: Partial<Verification>): Verification => ({
  id: '00000000-0000-4000-8000-000000000001',
  type: 'work_email',
  status: 'pending',
  failureCode: null,
  startedAt: '2026-11-27T05:00:00.000Z',
  completedAt: null,
  expiresAt: '2026-11-28T05:00:00.000Z',
  ...over,
});

describe('emailBadgeView', () => {
  it('the badge wins over any attempt', () => {
    expect(emailBadgeView('work_email', [{ type: 'work_verified' }], [attempt({})], NOW)).toEqual({
      kind: 'verified',
    });
    expect(emailBadgeView('college_email', [{ type: 'work_verified' }], [], NOW)).toEqual({
      kind: 'none',
    });
  });

  it('a pending, unexpired link of that kind is "sent"', () => {
    expect(emailBadgeView('work_email', [], [attempt({})], NOW)).toMatchObject({ kind: 'sent' });
    expect(
      emailBadgeView('work_email', [], [attempt({ expiresAt: '2026-11-27T05:59:00.000Z' })], NOW),
    ).toEqual({ kind: 'none' });
    expect(emailBadgeView('college_email', [], [attempt({})], NOW)).toEqual({ kind: 'none' });
  });

  it('only the newest attempt of the kind counts; email_in_use is said', () => {
    const inUse = attempt({ status: 'failed', failureCode: 'email_in_use', completedAt: 'x' });
    expect(emailBadgeView('work_email', [], [inUse, attempt({})], NOW)).toEqual({ kind: 'in_use' });
    expect(emailBadgeView('work_email', [], [attempt({ type: 'digilocker' }), inUse], NOW)).toEqual(
      { kind: 'in_use' },
    );
  });
});

describe('emailFieldError', () => {
  it('maps the shared rules to copy', () => {
    expect(emailFieldError('work_email', 'a@gmail.com')).toBe('verification.email.errors.personal');
    expect(emailFieldError('college_email', 'a@infosys.com')).toBe(
      'verification.email.errors.notCollege',
    );
    expect(emailFieldError('work_email', 'nope')).toBe('verification.email.errors.invalid');
    expect(emailFieldError('work_email', 'a@infosys.com')).toBeNull();
  });
});

describe('emailStartErrorKey', () => {
  it.each([
    ['network', undefined, 'verification.errors.network'],
    [422, { errors: [{ code: 'personal_domain' }] }, 'verification.email.errors.personal'],
    [409, { code: 'conflict' }, 'verification.email.errors.already'],
    [
      429,
      { code: 'rate_limited', errors: [{ code: 'address_limited' }] },
      'verification.email.errors.addressLimit',
    ],
    [429, { code: 'rate_limited' }, 'verification.email.errors.tooMany'],
    [503, {}, 'verification.email.errors.sendFailed'],
    [500, {}, 'verification.errors.generic'],
  ] as const)('%s %j → %s', (status, body, key) => {
    expect(emailStartErrorKey(status, body)).toBe(key);
  });
});

describe('emailConfirmResult', () => {
  it.each([
    [
      200,
      { status: 'verified', type: 'college_email' },
      { kind: 'verified', type: 'college_email' },
    ],
    [200, { status: 'verified' }, { kind: 'error' }],
    [422, { errors: [{ code: 'link_expired' }] }, { kind: 'expired' }],
    [422, { errors: [{ code: 'email_in_use' }] }, { kind: 'in_use' }],
    [422, { errors: [{ code: 'link_invalid' }] }, { kind: 'invalid' }],
    [422, { errors: [{ path: 'body.token', code: 'invalid_string' }] }, { kind: 'invalid' }],
    [429, {}, { kind: 'error' }],
    ['network', undefined, { kind: 'error' }],
  ] as const)('%s %j', (status, body, result) => {
    expect(emailConfirmResult(status, body)).toEqual(result);
  });
});

describe('tokenFromHash', () => {
  const t = 'A'.repeat(42) + '_';
  it('reads the token from the fragment only when whole', () => {
    expect(tokenFromHash(`#token=${t}`)).toBe(t);
    expect(tokenFromHash(`#x=1&token=${t}`)).toBe(t);
    expect(tokenFromHash(`#token=${t.slice(1)}`)).toBeNull();
    expect(tokenFromHash(`#token=${t}x`)).toBeNull();
    expect(tokenFromHash('')).toBeNull();
  });
});
