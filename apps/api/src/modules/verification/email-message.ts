/**
 * The work/college email link message (T3.3), in the member's language. Plain text only: no
 * tracking, no images, no name (whoever reads the mailbox may not be the member who asked).
 * Hindi is a draft for the founder's language review (T0.12).
 */
import type { EmailVerificationType } from '@flatrimony/shared';
import type { EmailMessage } from '../../lib/email.js';

type Locale = 'en' | 'hi';

const COPY: Record<
  Locale,
  Record<EmailVerificationType, { subject: string; intro: string; badge: string }> & {
    once: string;
    ignore: string;
    sign: string;
  }
> = {
  en: {
    work_email: {
      subject: 'Confirm your work email for Flatrimony',
      intro: 'Open this link to confirm your work email on Flatrimony:',
      badge:
        'Your profile will then show "Verified company". It never shows your employer or this address.',
    },
    college_email: {
      subject: 'Confirm your college email for Flatrimony',
      intro: 'Open this link to confirm your college email on Flatrimony:',
      badge:
        'Your profile will then show "Verified student". It never shows your college or this address.',
    },
    once: 'The link works once and expires in 24 hours.',
    ignore:
      'If you did not ask for this, ignore this email: nothing happens unless the link is opened.',
    sign: 'Flatrimony',
  },
  hi: {
    work_email: {
      subject: 'Flatrimony के लिए अपना ऑफ़िस ईमेल कन्फ़र्म करें',
      intro: 'Flatrimony पर अपना ऑफ़िस ईमेल कन्फ़र्म करने के लिए यह लिंक खोलें:',
      badge:
        'इसके बाद आपकी प्रोफ़ाइल पर "वेरिफ़ाइड कंपनी" दिखेगा। आपकी कंपनी का नाम या यह ईमेल कभी नहीं दिखेगा।',
    },
    college_email: {
      subject: 'Flatrimony के लिए अपना कॉलेज ईमेल कन्फ़र्म करें',
      intro: 'Flatrimony पर अपना कॉलेज ईमेल कन्फ़र्म करने के लिए यह लिंक खोलें:',
      badge:
        'इसके बाद आपकी प्रोफ़ाइल पर "वेरिफ़ाइड स्टूडेंट" दिखेगा। आपके कॉलेज का नाम या यह ईमेल कभी नहीं दिखेगा।',
    },
    once: 'यह लिंक एक ही बार चलता है और 24 घंटे में खत्म हो जाता है।',
    ignore: 'अगर आपने यह नहीं माँगा था, तो इस ईमेल को अनदेखा करें: लिंक खोले बिना कुछ नहीं होगा।',
    sign: 'Flatrimony',
  },
};

/**
 * The confirm page on the web app (`/{locale}/verify-email`), with the token in the fragment: a
 * fragment never reaches a server, a log or a Referer.
 */
export function emailLink(webAppUrl: string, locale: Locale, token: string): string {
  return `${webAppUrl.replace(/\/+$/, '')}/${locale}/verify-email#token=${token}`;
}

export function emailVerificationMessage(args: {
  to: string;
  type: EmailVerificationType;
  locale: string;
  link: string;
}): EmailMessage {
  const locale: Locale = args.locale === 'hi' ? 'hi' : 'en';
  const c = COPY[locale];
  const kind = c[args.type];
  return {
    to: args.to,
    subject: kind.subject,
    text: [kind.intro, '', args.link, '', c.once, kind.badge, '', c.ignore, '', `— ${c.sign}`].join(
      '\n',
    ),
  };
}
