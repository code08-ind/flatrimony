/**
 * Work and college email addresses (T3.3; FR-VER-05). The API and the apps share these rules so a
 * member hears about a personal or unknown address before a link is sent.
 *
 * What the badge proves: the member read a mailbox at that domain. A work badge says "a company
 * mailbox" (no personal or throwaway mail service); a college badge says "an academic domain"
 * (.ac.in, .edu.in, .edu). Neither names the employer or college (the domain stays private).
 *
 * The lists are technical starting points for founder sign-off (docs/07 T3.3), not a list of
 * companies or colleges: we never claim a company is "verified" beyond controlling its domain.
 */

export type EmailVerificationKind = 'work_email' | 'college_email';

export type EmailProblem =
  'invalid_email' | 'personal_domain' | 'disposable_domain' | 'not_a_college_domain';

/** Free personal mail services: an address there says nothing about an employer. */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.in',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'outlook.in',
  'hotmail.com',
  'hotmail.co.in',
  'live.com',
  'live.in',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'zohomail.com',
  'zohomail.in',
  'rediffmail.com',
  'rediff.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'tutanota.com',
  'tuta.io',
  'hey.com',
  'fastmail.com',
  'inbox.com',
  'indiatimes.com',
  'sify.com',
]);

/** Throwaway inboxes (anyone can read them). Not complete: obscure ones get through. */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'sharklasers.com',
  '10minutemail.com',
  'temp-mail.org',
  'tempmail.com',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'mailnesia.com',
  'throwawaymail.com',
  'fakeinbox.com',
  'mohmal.com',
  'emailondeck.com',
]);

/** Academic domains: Indian colleges and universities (.ac.in, .edu.in) and .edu. */
export const COLLEGE_EMAIL_SUFFIXES = ['.ac.in', '.edu.in', '.edu'] as const;

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
// The database's email_verifications_domain_chk, plus the 63-character label limit.
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export interface NormalisedEmail {
  /** As the member typed it, trimmed, with the domain in lower case: where the link goes. */
  address: string;
  domain: string;
  /**
   * One mailbox, one account: lower case and without a "+tag" (name+x@ and name@ reach the same
   * inbox). Only ever hashed, never stored.
   */
  canonical: string;
}

/**
 * The address split and checked, or null when it is not a plain address. Internationalised
 * domains must be typed in their ASCII form (xn--…); Indian company and college domains are ASCII.
 */
export function normaliseEmail(raw: string): NormalisedEmail | null {
  const text = raw.trim();
  if (text.length < 3 || text.length > 254) return null;
  const at = text.lastIndexOf('@');
  if (at <= 0 || at === text.length - 1) return null;
  const local = text.slice(0, at);
  const domain = text
    .slice(at + 1)
    .toLowerCase()
    .replace(/\.$/, '');
  if (local.length > 64 || !LOCAL_PART.test(local)) return null;
  if (domain.length > 253 || !DOMAIN.test(domain)) return null;
  const plus = local.indexOf('+');
  const base = (plus > 0 ? local.slice(0, plus) : local).toLowerCase();
  return { address: `${local}@${domain}`, domain, canonical: `${base}@${domain}` };
}

/** The domain or any domain it is under is in the set (mail.yopmail.com counts as yopmail.com). */
function underAny(domain: string, set: ReadonlySet<string>): boolean {
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i += 1)
    if (set.has(labels.slice(i).join('.'))) return true;
  return false;
}

export const isCollegeDomain = (domain: string) =>
  COLLEGE_EMAIL_SUFFIXES.some((s) => domain.endsWith(s) && domain.length > s.length);

/** Why this address cannot earn the badge, or null when it can. */
export function emailProblem(kind: EmailVerificationKind, raw: string): EmailProblem | null {
  const email = normaliseEmail(raw);
  if (!email) return 'invalid_email';
  if (underAny(email.domain, DISPOSABLE_EMAIL_DOMAINS)) return 'disposable_domain';
  if (kind === 'college_email')
    return isCollegeDomain(email.domain) ? null : 'not_a_college_domain';
  return underAny(email.domain, PERSONAL_EMAIL_DOMAINS) ? 'personal_domain' : null;
}
