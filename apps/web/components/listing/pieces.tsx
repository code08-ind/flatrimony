'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { isComplete } from '@flatrimony/client';
import { useT } from '../../lib/client/app-context';
import { useMe } from '../../lib/client/me';
import { SessionEnded } from '../SessionEnded';
import { Button, Frame, Notice } from '../ui';

/**
 * The listing pages need a finished profile (like the Android app's listings layout); members
 * looking for a room have nothing to list (FR-LST-01; the API refuses them anyway).
 */
export function ListingGate({ children }: { children: ReactNode }) {
  const { status, me, refresh } = useMe();
  const router = useRouter();
  const { t, locale } = useT();
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
  if (me.intent !== 'have_room')
    return (
      <Frame wide>
        <header className="step-header">
          <p className="overline">{t('listing.myFlat.overline')}</p>
          <h1>{t('listing.myFlat.notHaveRoomTitle')}</h1>
          <p className="subtitle">{t('listing.myFlat.notHaveRoomBody')}</p>
        </header>
      </Frame>
    );
  return <>{children}</>;
}

/**
 * "Are you sure?" as a modal dialog (focus stays inside; Escape cancels). Open while `open` is
 * true; answers through onConfirm / onCancel.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirm-title" className="h3">
        {title}
      </h2>
      <p id="confirm-body" className="muted">
        {body}
      </p>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button onClick={onConfirm} testId="confirm-yes">
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
