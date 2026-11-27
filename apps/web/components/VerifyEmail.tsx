'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emailConfirmResult, tokenFromHash, type EmailConfirmResult } from '@flatrimony/client';
import { useT } from '../lib/client/app-context';
import { api, NetworkError } from '../lib/client/api';
import { Button, Frame, Notice } from './ui';

type State = { kind: 'checking' } | { kind: 'no_token' } | EmailConfirmResult;

/**
 * The page a work/college email link opens (T3.3, FR-VER-05): `/{locale}/verify-email#token=…`.
 * The token is in the fragment, so it never reaches a server log or a Referer; the page reads it,
 * takes it out of the address bar and history, and confirms it through this site's /api/v1. No
 * sign-in is needed: the link may be opened on a work computer.
 */
export function VerifyEmail() {
  const { t, locale } = useT();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const token = useRef<string | null | undefined>(undefined);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // Each new outcome moves focus to its heading (screen readers hear it), once.
  useEffect(() => {
    if (state.kind !== 'checking') heading.current?.focus();
  }, [state.kind]);

  const confirm = useCallback(async () => {
    const value = token.current;
    if (!value) return setState({ kind: 'no_token' });
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: 'checking' });
    try {
      const res = await api('/verifications/email/confirm', {
        method: 'POST',
        body: { token: value },
        locale,
      });
      setState(emailConfirmResult(res.status, res.body));
    } catch (err) {
      setState(emailConfirmResult(err instanceof NetworkError ? 'network' : 500));
    } finally {
      inFlight.current = false;
    }
  }, [locale]);

  useEffect(() => {
    /** Takes the token out of the address bar and the history (not something to share). */
    const take = () => {
      token.current = tokenFromHash(window.location.hash);
      if (window.location.hash)
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    if (token.current === undefined) take();
    void confirm();
    // A whole link pasted into this tab after a cut-short one changes only the fragment: no
    // reload, so read it here.
    const onHash = () => {
      if (!window.location.hash) return;
      take();
      void confirm();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [confirm]);

  const home = (
    <Link className="btn btn-secondary" href={`/${locale}`}>
      <span>{t('web.verifyEmail.home')}</span>
    </Link>
  );

  const [title, body] = ((): [string, string] => {
    switch (state.kind) {
      case 'checking':
        return [t('web.verifyEmail.checking'), ''];
      case 'verified':
        return [
          t('web.verifyEmail.verifiedTitle'),
          t(
            state.type === 'work_email'
              ? 'web.verifyEmail.verifiedWork'
              : 'web.verifyEmail.verifiedCollege',
          ),
        ];
      case 'expired':
        return [t('web.verifyEmail.expiredTitle'), t('web.verifyEmail.expiredBody')];
      case 'invalid':
        return [t('web.verifyEmail.invalidTitle'), t('web.verifyEmail.invalidBody')];
      case 'in_use':
        return [t('verification.email.inUse.title'), t('verification.email.inUse.body')];
      case 'no_token':
        return [t('web.verifyEmail.noTokenTitle'), t('web.verifyEmail.noTokenBody')];
      case 'rate_limited':
        return [t('web.verifyEmail.tooManyTitle'), t('web.verifyEmail.tooManyBody')];
      case 'error':
        return [t('web.verifyEmail.errorTitle'), t('web.verifyEmail.errorBody')];
    }
  })();

  return (
    <Frame
      actions={
        state.kind === 'checking' ? null : (
          <>
            {state.kind === 'error' || state.kind === 'rate_limited' ? (
              <Button testId="verify-email-retry" onClick={() => void confirm()}>
                {t('web.verifyEmail.retry')}
              </Button>
            ) : null}
            {home}
          </>
        )
      }
    >
      <div className="stack" data-testid={`verify-email-${state.kind}`}>
        <p className="overline">{t('verification.email.overline')}</p>
        {state.kind === 'checking' ? (
          <h1 role="status" aria-live="polite">
            {title}
          </h1>
        ) : (
          <h1 tabIndex={-1} ref={heading}>
            {title}
          </h1>
        )}
        {state.kind === 'verified' ? (
          <Notice tone="info">{body}</Notice>
        ) : state.kind === 'checking' ? null : (
          <p className="muted">{body}</p>
        )}
      </div>
    </Frame>
  );
}
