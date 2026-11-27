import { describe, expect, it } from 'vitest';
import { emailProblem, isCollegeDomain, normaliseEmail } from './email.js';

describe('normaliseEmail', () => {
  it('lower-cases the domain, keeps the local part for delivery, drops +tags for the canonical', () => {
    expect(normaliseEmail('  Asha.Rao+flats@Example.CO.IN ')).toEqual({
      address: 'Asha.Rao+flats@example.co.in',
      domain: 'example.co.in',
      canonical: 'asha.rao@example.co.in',
    });
  });

  it('accepts a trailing dot on the domain and punycode domains', () => {
    expect(normaliseEmail('a@example.com.')?.domain).toBe('example.com');
    expect(normaliseEmail('a@xn--h2brj9c.xn--h2brj9c')?.domain).toBe('xn--h2brj9c.xn--h2brj9c');
  });

  it.each([
    '',
    'plain',
    '@example.com',
    'a@',
    'a@@example.com',
    'a b@example.com',
    'a..b@example.com',
    '.a@example.com',
    'a@localhost',
    'a@-example.com',
    'a@example..com',
    'a@exämple.com',
    'a@example.c',
    `${'x'.repeat(65)}@example.com`,
    `a@${'x'.repeat(250)}.com`,
  ])('refuses %j', (raw) => {
    expect(normaliseEmail(raw)).toBeNull();
  });
});

describe('emailProblem', () => {
  it('accepts a company domain for work', () => {
    expect(emailProblem('work_email', 'asha@infosys.com')).toBeNull();
    expect(emailProblem('work_email', 'asha@iitd.ac.in')).toBeNull(); // college staff work there
  });

  it('refuses personal mail services for work, subdomains included', () => {
    expect(emailProblem('work_email', 'asha@gmail.com')).toBe('personal_domain');
    expect(emailProblem('work_email', 'asha@Yahoo.co.in')).toBe('personal_domain');
    expect(emailProblem('work_email', 'asha@in.outlook.com')).toBe('personal_domain');
  });

  it('refuses throwaway inboxes for both kinds', () => {
    expect(emailProblem('work_email', 'x@mailinator.com')).toBe('disposable_domain');
    expect(emailProblem('work_email', 'x@a.yopmail.com')).toBe('disposable_domain');
    expect(emailProblem('college_email', 'x@mailinator.com')).toBe('disposable_domain');
  });

  it('accepts academic domains for college only', () => {
    expect(emailProblem('college_email', 'asha@iitd.ac.in')).toBeNull();
    expect(emailProblem('college_email', 'asha@students.amity.edu')).toBeNull();
    expect(emailProblem('college_email', 'asha@bennett.edu.in')).toBeNull();
    expect(emailProblem('college_email', 'asha@infosys.com')).toBe('not_a_college_domain');
    expect(emailProblem('college_email', 'asha@gmail.com')).toBe('not_a_college_domain');
    expect(emailProblem('college_email', 'asha@fakeac.in')).toBe('not_a_college_domain');
  });

  it('says when the address is not one', () => {
    expect(emailProblem('work_email', 'not an email')).toBe('invalid_email');
  });

  it('does not take a bare suffix for a college', () => {
    expect(isCollegeDomain('ac.in')).toBe(false);
    expect(isCollegeDomain('edu')).toBe(false);
    expect(isCollegeDomain('du.ac.in')).toBe(true);
  });
});
