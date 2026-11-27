'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  coverPhotoUrl,
  listingActions,
  listingResumeStep,
  statusChip,
  stepIndex,
} from '@flatrimony/client';
import { formatINR, type MessageKey } from '@flatrimony/i18n';
import type { OwnerListing } from '@flatrimony/shared';
import { useT } from '../../lib/client/app-context';
import { actOn, deleteListing, useMyListings } from '../../lib/client/listings';
import { Button, Frame, Notice } from '../ui';
import { ConfirmDialog } from './pieces';

/**
 * My Flat on the web (T3.9b; docs/06 §8.12 "Listing management"; design M33 lower half): the
 * owner's listings with their status ("Active · expires in 4 days", "Draft · step 5 of 6"), the
 * one-tap "Still available" (FR-LST-07), continue or edit, pause or resume, and delete.
 */
export function MyFlat() {
  const { t, locale } = useT();
  const mine = useMyListings();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; key: MessageKey } | null>(null);
  const [deleting, setDeleting] = useState<OwnerListing | null>(null);
  const { refresh } = mine;
  useEffect(() => {
    void refresh();
    // Back from "Save draft" (?saved=1): say so once, then drop the flag from the URL.
    if (new URLSearchParams(window.location.search).get('saved') === '1') {
      setNotice({ tone: 'info', key: 'listing.editor.saved' });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [refresh]);

  const run = async (
    listing: OwnerListing,
    work: () => Promise<{ ok: boolean; error?: MessageKey }>,
    done?: MessageKey,
  ) => {
    setBusy(listing.id);
    setNotice(null);
    const result = await work();
    setBusy(null);
    if (!result.ok)
      setNotice({ tone: 'error', key: result.error ?? 'listing.editor.errors.generic' });
    else if (done) setNotice({ tone: 'info', key: done });
    await refresh();
  };

  const listings = mine.listings ?? [];
  const newListing = `/${locale}/listings/edit`;
  return (
    <Frame wide>
      <header className="step-header">
        <p className="overline">{t('listing.myFlat.overline')}</p>
        <h1>{t('listing.myFlat.heading')}</h1>
      </header>
      {notice ? <Notice tone={notice.tone}>{t(notice.key)}</Notice> : null}
      {mine.status === 'error' ? (
        <section className="card">
          <Notice tone="error">{t('listing.myFlat.loadFailed')}</Notice>
          <Button variant="secondary" onClick={() => void refresh()}>
            {t('listing.myFlat.retry')}
          </Button>
        </section>
      ) : null}
      {mine.status === 'loading' && !mine.listings ? (
        <p className="muted" role="status">
          {t('state.loading')}
        </p>
      ) : null}

      {mine.listings && listings.length === 0 ? (
        <section className="card empty-card">
          <span className="icon-circle" aria-hidden="true">
            ⌂
          </span>
          <h2>{t('listing.myFlat.emptyTitle')}</h2>
          <p className="muted">{t('listing.myFlat.emptyBody')}</p>
          <Link className="btn btn-primary" href={newListing} data-testid="my-flat-start">
            {t('listing.myFlat.start')}
          </Link>
        </section>
      ) : null}

      <div className="listing-cards">
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            busy={busy === listing.id}
            onConfirm={() =>
              void run(
                listing,
                () => actOn(listing.id, 'confirm-available'),
                'listing.myFlat.confirmed',
              )
            }
            onPause={() => void run(listing, () => actOn(listing.id, 'pause'))}
            onResume={() => void run(listing, () => actOn(listing.id, 'resume'))}
            onDelete={() => setDeleting(listing)}
          />
        ))}
      </div>

      {listings.length > 0 ? (
        <Link className="btn btn-secondary" href={newListing}>
          {`+ ${t('listing.myFlat.another')}`}
        </Link>
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        title={t('listing.myFlat.deleteTitle')}
        body={t('listing.myFlat.deleteBody')}
        confirmLabel={t('listing.myFlat.deleteConfirm')}
        cancelLabel={t('listing.myFlat.cancel')}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void run(target, () => deleteListing(target.id), 'listing.myFlat.deleted');
        }}
        onCancel={() => setDeleting(null)}
      />
    </Frame>
  );
}

function ListingCard({
  listing,
  busy,
  onConfirm,
  onPause,
  onResume,
  onDelete,
}: {
  listing: OwnerListing;
  busy: boolean;
  onConfirm: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useT();
  const chip = statusChip(listing, Date.now());
  const actions = listingActions(listing);
  const cover = coverPhotoUrl(listing);
  const chipText =
    chip.kind === 'active'
      ? chip.daysLeft > 0
        ? t('listing.myFlat.status.active', { days: chip.daysLeft })
        : t('listing.myFlat.status.activeToday')
      : chip.kind === 'draft'
        ? t('listing.myFlat.status.draft', { step: stepIndex(listingResumeStep(listing)) + 1 })
        : t(`listing.myFlat.status.${chip.kind}`);
  const step = listing.status === 'draft' ? listingResumeStep(listing) : 'basics';
  const edit = `/${locale}/listings/edit?id=${encodeURIComponent(listing.id)}&step=${step}`;

  return (
    <article className="card listing-card" aria-labelledby={`listing-${listing.id}`}>
      {cover ? (
        // Signed, short-lived storage URLs: next/image cannot optimise them.
        <img className="cover" src={cover} alt="" />
      ) : (
        <div className="cover no-cover">
          <span className="muted caption">{t('listing.myFlat.noPhoto')}</span>
        </div>
      )}
      <span className={chip.kind === 'active' ? 'status-chip live' : 'status-chip'}>
        {chipText}
      </span>
      <h2 className="h3" id={`listing-${listing.id}`}>
        {listing.title}
      </h2>
      {listing.costs && listing.trueMonthlyPerPersonInr !== null ? (
        <p className="muted">
          {t('listing.editor.review.allIn', {
            amount: formatINR(listing.trueMonthlyPerPersonInr, locale),
          })}
        </p>
      ) : null}
      {actions.confirm ? (
        <div className="stack-tight">
          <Button testId="listing-still-available" busy={busy} onClick={onConfirm}>
            {t('listing.myFlat.stillAvailable')}
          </Button>
          <p className="muted caption center">{t('listing.myFlat.stillAvailableHint')}</p>
        </div>
      ) : null}
      <div className="card-actions">
        {actions.continueDraft ? (
          <Link
            className="btn btn-primary"
            href={edit}
            aria-disabled={busy || undefined}
            onClick={(e) => busy && e.preventDefault()}
            data-testid="listing-continue"
          >
            {t('listing.myFlat.continue')}
          </Link>
        ) : actions.edit ? (
          <Link
            className="btn btn-secondary"
            href={edit}
            aria-disabled={busy || undefined}
            onClick={(e) => busy && e.preventDefault()}
          >
            {t('listing.myFlat.edit')}
          </Link>
        ) : null}
        {actions.pause ? (
          <Button variant="secondary" disabled={busy} onClick={onPause}>
            {t('listing.myFlat.pause')}
          </Button>
        ) : null}
        {actions.resume ? (
          <Button variant="secondary" disabled={busy} onClick={onResume}>
            {t('listing.myFlat.resume')}
          </Button>
        ) : null}
        <Button variant="secondary" disabled={busy} onClick={onDelete}>
          {t('listing.myFlat.delete')}
        </Button>
      </div>
    </article>
  );
}
