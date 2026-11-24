'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useT } from '../lib/client/app-context';
import { signOut } from '../lib/client/auth';
import { Button, Frame, Notice } from './ui';

/**
 * The session is over (the API answered 401): clear it on the server, then go to sign-in. If the
 * server could not clear it, say so and offer a retry rather than bounce between pages (sign-in
 * would see the cookie and send the user straight back).
 */
export function SessionEnded() {
  const router = useRouter();
  const { t, locale } = useT();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void signOut().then((ok) => {
      if (!live) return;
      if (ok) router.replace(`/${locale}/sign-in`);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [attempt, locale, router]);
  return (
    <Frame>
      {failed ? (
        <div className="stack">
          <Notice tone="error">{t('auth.errors.unavailable')}</Notice>
          <Button
            variant="secondary"
            onClick={() => {
              setFailed(false);
              setAttempt((a) => a + 1);
            }}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <p className="muted" role="status">
          {t('state.loading')}
        </p>
      )}
    </Frame>
  );
}
