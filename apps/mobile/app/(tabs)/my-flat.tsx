import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  listingActions,
  listingResumeStep,
  coverPhotoUrl,
  stepIndex,
  statusChip,
} from '@flatrimony/client';
import { formatINR, type MessageKey } from '@flatrimony/i18n';
import type { OwnerListing } from '@flatrimony/shared';
import { actOn, deleteListing, useMyListings } from '../../src/listing/api';
import { useMe } from '../../src/me';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton, SecondaryButton } from '../../src/ui/buttons';
import { confirmAction } from '../../src/ui/confirm';
import { House, Lightning, Plus, Trash } from '../../src/ui/icons';
import { Notice } from '../../src/ui/Notice';
import { Screen } from '../../src/ui/Screen';

/**
 * My Flat (docs/06 §8.12 "Listing management"; design M33 lower half): the owner's listings with
 * their status ("Active · expires in 4 days"), the one-tap "Still available" (FR-LST-07), edit,
 * pause or resume, and delete. Members looking for a room have nothing to list here.
 */
export default function MyFlatScreen() {
  const { t, locale } = useT();
  const { me } = useMe();
  const mine = useMyListings();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; key: MessageKey } | null>(null);

  // Back from the editor or the recorder: show what changed.
  useFocusEffect(
    useCallback(() => {
      void mine.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable
    }, []),
  );

  if (me && me.intent !== 'have_room')
    return (
      <Screen>
        <Header />
        <View style={styles.card}>
          <Text style={[textStyle('h3', locale), styles.primary]}>
            {t('listing.myFlat.notHaveRoomTitle')}
          </Text>
          <Text style={[textStyle('body', locale), styles.muted]}>
            {t('listing.myFlat.notHaveRoomBody')}
          </Text>
        </View>
      </Screen>
    );

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
    await mine.refresh();
  };

  const remove = async (listing: OwnerListing) => {
    const ok = await confirmAction({
      title: t('listing.myFlat.deleteTitle'),
      message: t('listing.myFlat.deleteBody'),
      confirmLabel: t('listing.myFlat.deleteConfirm'),
      cancelLabel: t('listing.myFlat.cancel'),
    });
    if (ok) await run(listing, () => deleteListing(listing.id), 'listing.myFlat.deleted');
  };

  const listings = mine.listings ?? [];
  return (
    <Screen>
      <Header />
      {notice ? <Notice tone={notice.tone} locale={locale} message={t(notice.key)} /> : null}
      {mine.status === 'error' ? (
        <View style={styles.card}>
          <Notice tone="error" locale={locale} message={t('listing.myFlat.loadFailed')} />
          <SecondaryButton
            label={t('listing.myFlat.retry')}
            onPress={() => void mine.refresh()}
            locale={locale}
            trailingArrow={false}
          />
        </View>
      ) : null}
      {mine.status === 'loading' && !mine.listings ? (
        <ActivityIndicator color={theme.color.brand.primary} />
      ) : null}

      {mine.listings && listings.length === 0 ? (
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <House size={28} color={theme.color.brand.primary} weight="fill" />
          </View>
          <Text style={[textStyle('h2', locale), styles.primary]}>
            {t('listing.myFlat.emptyTitle')}
          </Text>
          <Text style={[textStyle('body', locale), styles.muted]}>
            {t('listing.myFlat.emptyBody')}
          </Text>
          <PrimaryButton
            testID="my-flat-start"
            label={t('listing.myFlat.start')}
            onPress={() => router.push('/listings/edit')}
            locale={locale}
          />
        </View>
      ) : null}

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
          onDelete={() => void remove(listing)}
        />
      ))}

      {listings.length > 0 ? (
        <SecondaryButton
          label={t('listing.myFlat.another')}
          onPress={() => router.push('/listings/edit')}
          locale={locale}
          trailingArrow={false}
          icon={<Plus size={20} color={theme.color.brand.primary} />}
        />
      ) : null}
    </Screen>
  );
}

function Header() {
  const { t, locale } = useT();
  return (
    <View style={styles.titles}>
      <Text style={[textStyle('label', locale), styles.overline]}>
        {t('listing.myFlat.overline')}
      </Text>
      <Text accessibilityRole="header" style={textStyle('display', locale)}>
        {t('listing.myFlat.heading')}
      </Text>
    </View>
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
  const edit = () =>
    router.push({
      pathname: '/listings/edit',
      params: {
        id: listing.id,
        step: listing.status === 'draft' ? listingResumeStep(listing) : 'basics',
      },
    });

  return (
    <View style={styles.card} testID={`listing-${listing.id}`}>
      {cover ? (
        <Image source={{ uri: cover }} style={styles.cover} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.cover, styles.noCover]}>
          <Text style={[textStyle('caption', locale), styles.muted]}>
            {t('listing.myFlat.noPhoto')}
          </Text>
        </View>
      )}
      <View style={[styles.chip, chip.kind === 'active' ? styles.chipLive : styles.chipOther]}>
        <Text style={[textStyle('label', locale), styles.primary]}>{chipText}</Text>
      </View>
      <Text style={[textStyle('h3', locale), styles.primary]}>{listing.title}</Text>
      {listing.trueMonthlyPerPersonInr !== null ? (
        <Text style={[textStyle('body', locale), styles.muted]}>
          {t('listing.editor.review.allIn', {
            amount: formatINR(listing.trueMonthlyPerPersonInr, locale),
          })}
        </Text>
      ) : null}

      {actions.confirm ? (
        <View style={{ gap: theme.space['2'] }}>
          <PrimaryButton
            testID="listing-still-available"
            label={t('listing.myFlat.stillAvailable')}
            onPress={onConfirm}
            busy={busy}
            locale={locale}
            trailingArrow={false}
            icon={<Lightning size={20} color={theme.semantic.action.primary.fg} weight="fill" />}
          />
          <Text style={[textStyle('caption', locale), styles.muted, styles.center]}>
            {t('listing.myFlat.stillAvailableHint')}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        {actions.continueDraft ? (
          <PrimaryButton
            label={t('listing.myFlat.continue')}
            onPress={edit}
            locale={locale}
            disabled={busy}
          />
        ) : actions.edit ? (
          <SecondaryButton
            label={t('listing.myFlat.edit')}
            onPress={edit}
            locale={locale}
            disabled={busy}
            trailingArrow={false}
          />
        ) : null}
        {actions.pause ? (
          <SecondaryButton
            label={t('listing.myFlat.pause')}
            onPress={onPause}
            locale={locale}
            disabled={busy}
            trailingArrow={false}
          />
        ) : null}
        {actions.resume ? (
          <SecondaryButton
            label={t('listing.myFlat.resume')}
            onPress={onResume}
            locale={locale}
            disabled={busy}
            trailingArrow={false}
          />
        ) : null}
        <SecondaryButton
          label={t('listing.myFlat.delete')}
          onPress={onDelete}
          locale={locale}
          disabled={busy}
          trailingArrow={false}
          icon={<Trash size={20} color={theme.color.brand.primary} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titles: { gap: theme.space['2'] },
  overline: { color: theme.color.brand.primary, textTransform: 'uppercase' },
  primary: { color: theme.color.text.primary },
  muted: { color: theme.color.text.secondary },
  center: { textAlign: 'center' },
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['3'],
    ...theme.elevation['1'],
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.brand.primarySubtle,
  },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: theme.radius.md },
  noCover: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.brand.primarySubtle,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space['3'],
    paddingVertical: theme.space['1'],
    borderRadius: theme.radius.full,
  },
  chipLive: { backgroundColor: theme.semantic.status.verified.bg },
  chipOther: { backgroundColor: theme.color.brand.primarySubtle },
  actions: { gap: theme.space['2'] },
});
