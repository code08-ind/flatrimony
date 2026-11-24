'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  clearsCode,
  codeStillFresh,
  displayE164,
  formatCountdown,
  formatNational,
  hasValidStart,
  isValidMobile,
  requestErrorKey,
  requestOtp,
  sanitiseNational,
  secondsLeft,
  toE164,
  verifyErrorKey,
  verifyOtp,
  fetchWithTimeout,
  type RequestOtpResult,
} from '@flatrimony/client';
import { authConfigured, useConfig, useT } from '../lib/client/app-context';
import { getDeviceId, webAuthClient } from '../lib/client/auth';
import { resetDraft } from '../lib/client/onboarding';
import { Button, Frame, LegalConsent, Notice } from './ui';

type Sent = { phone: string; sentAt: number };

/**
 * Phone sign-in (FR-AUTH-01; designs M02/M03 on one page): the number, then the 6-digit code.
 * The number stays in this page's memory only (never in the URL or storage).
 */
export function SignIn() {
  const { t, locale } = useT();
  const config = useConfig();
  const router = useRouter();
  const [sent, setSent] = useState<Sent | null>(null);
  // Kept after "Wrong number?": the same number again reuses its code while it is still fresh.
  const [lastSent, setLastSent] = useState<Sent | null>(null);
  const auth = webAuthClient(config);
  const deps = {
    auth,
    fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
      fetchWithTimeout(url, init),
    apiUrl: config.apiUrl,
    deviceId: '',
    appVersion: config.appVersion,
    platform: 'web' as const,
  };
  const request = (phone: string) => requestOtp({ ...deps, deviceId: getDeviceId() }, phone);
  const rateMessage = (r: Extract<RequestOtpResult, { ok: false }>) =>
    r.reason === 'rate_limited'
      ? t('auth.errors.rateLimited', { minutes: Math.ceil(r.retryAfterSeconds / 60) })
      : t(requestErrorKey(r.reason));

  return sent ? (
    <CodeStep
      sent={sent}
      onChangeNumber={() => {
        setLastSent(sent);
        setSent(null);
      }}
      resend={async () => {
        const r = await request(sent.phone);
        if (r.ok) setSent({ phone: sent.phone, sentAt: Date.now() });
        return r.ok ? null : rateMessage(r);
      }}
      verify={(code) => verifyOtp({ auth }, sent.phone, code)}
      onSignedIn={() => {
        resetDraft(); // a new session starts with no one else's unsaved answers
        router.replace(`/${locale}/onboarding`);
      }}
    />
  ) : (
    <PhoneStep
      configured={authConfigured(config)}
      lastSent={lastSent}
      onSent={setSent}
      request={request}
      message={rateMessage}
    />
  );
}

function PhoneStep({
  configured,
  lastSent,
  onSent,
  request,
  message,
}: {
  configured: boolean;
  lastSent: Sent | null;
  onSent: (s: Sent) => void;
  request: (phone: string) => Promise<RequestOtpResult>;
  message: (r: Extract<RequestOtpResult, { ok: false }>) => string;
}) {
  const { t, locale } = useT();
  // After "Wrong number?" the number is still there to correct, not typed again.
  const [digits, setDigits] = useState(() => lastSent?.phone.replace(/^\+91/, '') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    if (!blockedUntil) return;
    const timer = setTimeout(() => {
      setBlockedUntil(0);
      setError(null);
    }, blockedUntil - Date.now());
    return () => clearTimeout(timer);
  }, [blockedUntil]);

  const valid = isValidMobile(digits);
  const badStart = !hasValidStart(digits);

  const send = async () => {
    if (!valid || inFlight.current || blockedUntil) return;
    if (!configured) return setError(t('auth.errors.notConfigured'));
    const phone = toE164(digits);
    if (lastSent && codeStillFresh(lastSent, phone, Date.now())) return onSent(lastSent);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await request(phone);
      if (result.ok) return onSent({ phone, sentAt: Date.now() });
      if (result.reason === 'rate_limited')
        setBlockedUntil(Date.now() + result.retryAfterSeconds * 1000);
      setError(message(result));
    } catch {
      setError(t('auth.errors.unavailable'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Frame>
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <header className="step-header">
          <div className="step-top">
            <Link className="back" href={`/${locale}`} aria-label={t('common.back')}>
              <span aria-hidden="true">←</span>
            </Link>
          </div>
          <h1 ref={heading} tabIndex={-1}>
            {t('auth.phone.title')}
          </h1>
          <p className="subtitle">{t('auth.phone.subtitle')}</p>
        </header>
        <div className="field">
          <label htmlFor="phone">{t('auth.phone.label')}</label>
          <div className="phone-input">
            <span className="prefix" id="phone-prefix">
              +91
            </span>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98123 45678"
              value={formatNational(digits)}
              aria-invalid={badStart || undefined}
              aria-describedby={badStart ? 'phone-prefix phone-error' : 'phone-prefix'}
              onChange={(e) => {
                if (!blockedUntil) setError(null);
                setDigits(sanitiseNational(e.target.value));
              }}
            />
          </div>
        </div>
        {badStart ? (
          <p id="phone-error" className="notice notice-error" role="alert">
            {t('auth.phone.startDigit')}
          </p>
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <p className="muted">{t('auth.phone.digilockerNote')}</p>
        )}
        <Button type="submit" busy={busy} disabled={!valid || !!blockedUntil} testId="send-code">
          {t('auth.phone.sendCode')}
        </Button>
        <LegalConsent />
      </form>
    </Frame>
  );
}

function CodeStep({
  sent,
  onChangeNumber,
  resend,
  verify,
  onSignedIn,
}: {
  sent: Sent;
  onChangeNumber: () => void;
  resend: () => Promise<string | null>;
  verify: (code: string) => ReturnType<typeof verifyOtp>;
  onSignedIn: () => void;
}) {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'error' | 'info';
    text: string;
    retry?: boolean;
  } | null>(null);
  const inFlight = useRef(false);
  const submitted = useRef('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = secondsLeft(sent.sentAt, now);

  const submit = async (value: string) => {
    if (inFlight.current || value.length !== 6 || submitted.current === value) return;
    inFlight.current = true;
    submitted.current = value;
    setBusy(true);
    setMessage(null);
    try {
      const result = await verify(value);
      if (result.ok) return onSignedIn();
      setMessage({
        tone: 'error',
        text: t(verifyErrorKey(result.reason)),
        retry: !clearsCode(result.reason),
      });
      if (clearsCode(result.reason)) {
        setCode('');
        input.current?.focus();
      }
    } finally {
      submitted.current = '';
      inFlight.current = false;
      setBusy(false);
    }
  };

  const again = async () => {
    if (left > 0 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const error = await resend();
      setMessage(
        error ? { tone: 'error', text: error } : { tone: 'info', text: t('auth.otp.resent') },
      );
      if (!error) setCode('');
    } catch {
      setMessage({ tone: 'error', text: t('auth.errors.unavailable') });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Frame>
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
      >
        <header className="step-header">
          <p className="overline">{t('auth.otp.overline')}</p>
          <h1>{t('auth.otp.title')}</h1>
          <p className="subtitle">
            {t('auth.otp.sentTo', { phone: displayE164(sent.phone) })}{' '}
            <button type="button" className="link" onClick={onChangeNumber}>
              {t('auth.otp.wrongNumber')}
            </button>
          </p>
        </header>
        <div className="field">
          <label htmlFor="otp">{t('auth.otp.codeLabel')}</label>
          <input
            ref={input}
            id="otp"
            name="otp"
            className="otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            aria-invalid={(message?.tone === 'error' && !message.retry) || undefined}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '').slice(0, 6);
              setMessage((m) => (m?.tone === 'error' ? null : m));
              setCode(value);
              if (value.length === 6) void submit(value);
            }}
          />
        </div>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <p className="muted">
          {left > 0 ? (
            t('auth.otp.resendIn', { time: formatCountdown(left) })
          ) : (
            <button type="button" className="link" disabled={busy} onClick={() => void again()}>
              {t('auth.otp.resend')}
            </button>
          )}
        </p>
        <Button type="submit" busy={busy} disabled={code.length !== 6} testId="verify">
          {t('auth.otp.verify')}
        </Button>
      </form>
    </Frame>
  );
}
