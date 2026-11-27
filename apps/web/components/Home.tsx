'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isComplete } from '@flatrimony/client';
import { useT } from '../lib/client/app-context';
import { signOut } from '../lib/client/auth';
import { useMe } from '../lib/client/me';
import { SessionEnded } from './SessionEnded';
import { Button, Frame, Notice } from './ui';

/**
 * After onboarding, until web Discover (W02) exists: the profile is saved; My Flat for members with
 * a room (T3.9b); sign out.
 */
export function Home() {
  const { status, me, refresh } = useMe();
  const router = useRouter();
  const { t, locale } = useT();
  const [leaving, setLeaving] = useState(false);
  const [leaveFailed, setLeaveFailed] = useState(false);

  const target = status === 'ready' && !isComplete(me) ? `/${locale}/onboarding` : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (status === 'signed_out') return <SessionEnded />;
  if (status === 'error')
    return (
      <Frame>
        <div className="stack">
          <Notice tone="error">{t('common.profileLoadFailed')}</Notice>
          <Button variant="secondary" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      </Frame>
    );
  if (target || !me)
    return (
      <Frame>
        <p className="muted" role="status">
          {t('state.loading')}
        </p>
      </Frame>
    );
  return (
    <Frame
      actions={
        <>
          {leaveFailed ? <Notice tone="error">{t('auth.errors.unavailable')}</Notice> : null}
          <Button
            variant="secondary"
            busy={leaving}
            onClick={async () => {
              setLeaving(true);
              setLeaveFailed(false);
              if (await signOut()) return router.replace(`/${locale}`);
              setLeaving(false);
              setLeaveFailed(true);
            }}
          >
            {leaving ? t('web.signingOut') : t('web.signOut')}
          </Button>
        </>
      }
    >
      <header className="step-header">
        <p className="overline">{me.displayName}</p>
        <h1>{t('web.savedTitle')}</h1>
        <p className="subtitle">{t('web.savedBody')}</p>
      </header>
      {me.intent === 'have_room' ? (
        <Link className="btn btn-primary" href={`/${locale}/my-flat`} data-testid="home-my-flat">
          {t('listing.myFlat.overline')}
        </Link>
      ) : null}
    </Frame>
  );
}
