'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { isComplete, resumeStep, stepAhead } from '@flatrimony/client';
import { useT } from '../lib/client/app-context';
import { useMe } from '../lib/client/me';
import { useDraft } from '../lib/client/onboarding';
import { SessionEnded } from './SessionEnded';
import { Button, Frame, Notice } from './ui';

/**
 * Keeps the user on the right onboarding step: never ahead of the first unanswered one, home once
 * everything is saved, back to sign-in when the session has ended.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { status, me, refresh } = useMe();
  const draft = useDraft();
  const path = usePathname();
  const router = useRouter();
  const { t, locale } = useT();

  const current = path.split('/')[3]; // /<locale>/onboarding/<step>
  let target: string | null = null;
  if (status === 'ready') {
    if (isComplete(me)) target = `/${locale}/home`;
    else {
      const first = resumeStep(me, draft) ?? 'habits';
      if (!current || stepAhead(current, first)) target = `/${locale}/onboarding/${first}`;
    }
  }

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
  if (target || (status === 'loading' && !me))
    return (
      <Frame>
        <p className="muted" role="status">
          {t('state.loading')}
        </p>
      </Frame>
    );
  return children;
}
