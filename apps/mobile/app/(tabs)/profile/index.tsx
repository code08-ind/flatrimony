import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { outcomeCopy, resumeFrom } from '@flatrimony/client';
import { VerificationList } from '@flatrimony/shared';
import { api } from '../../../src/api';
import { useMe } from '../../../src/me';
import { Avatar } from '../../../src/profile/Avatar';
import { PauseRow } from '../../../src/profile/PauseRow';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import {
  ArrowRight,
  CaretRight,
  EnvelopeSimple,
  SealCheck,
  ShieldCheck,
  Sparkle,
  UserCircle,
} from '../../../src/ui/icons';
import { Logo } from '../../../src/ui/Logo';
import { ProgressRing } from '../../../src/ui/ProgressRing';
import { Screen } from '../../../src/ui/Screen';

const CATEGORY_LABEL = {
  professional: 'onboarding.category.professional',
  student: 'onboarding.category.student',
  women_only: 'onboarding.category.womenOnly',
  relocating: 'onboarding.category.relocating',
} as const;

/**
 * M34 Profile tab (docs/06 §8.13; FR-BIO-01, FR-BIO-08): completion ring around the avatar, name
 * and age, the scenario "match accelerator", Flat Biodata and verification tiles, and pause.
 * "Preview as others see me", settings and My Flat arrive with their own tasks (docs/07 T2.11).
 */
export default function ProfileTab() {
  const { t, locale } = useT();
  const { me, refresh } = useMe();
  const { locale: lang } = useT();
  // After a final failure (under 18, identity on another account, banned) there is nothing to
  // start: the tile says so instead of "Verify now" (it still opens that result).
  const [cantVerify, setCantVerify] = useState(false);
  // Back on the tab: the profile may have changed elsewhere (a verification that finished after
  // the verify screen was left, say).
  useFocusEffect(
    useCallback(() => {
      void refresh({ quiet: true });
      let live = true;
      void api('/verifications', { locale: lang })
        .then((res) => {
          const parsed = VerificationList.safeParse(res.body);
          const resume = parsed.success ? resumeFrom(parsed.data.verifications, Date.now()) : null;
          if (live)
            setCantVerify(
              !!resume && 'outcome' in resume && outcomeCopy(resume.outcome).action === 'none',
            );
        })
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, [refresh, lang]),
  );
  if (!me) return null;
  const percent = me.biodataCompletion;
  const answered = me.scenarioAnswers?.length ?? 0;

  return (
    <Screen>
      <View style={styles.top}>
        <Logo size={36} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.editBiodata')}
          onPress={() => router.push('/profile/biodata')}
          style={styles.iconButton}
        >
          <UserCircle size={24} color={theme.color.text.primary} />
        </Pressable>
      </View>

      <View style={styles.header}>
        <ProgressRing
          size={168}
          progress={percent}
          label={`${t('profile.flatBiodataProfile')}: ${t('profile.complete', { percent })}`}
        >
          <Avatar me={me} size={144} />
        </ProgressRing>
        {/* The ring above already announces the completion. */}
        <View
          style={styles.pill}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Text style={[textStyle('label', locale), styles.pillText]}>
            {t('profile.flatBiodataProfile')} · {t('profile.complete', { percent })}
          </Text>
        </View>
        <Text style={textStyle('display', locale)} accessibilityRole="header">
          {me.age !== null
            ? t('profile.nameAge', { name: me.displayName, age: me.age })
            : me.displayName}
        </Text>
        <Text style={[textStyle('bodyLg', locale), { color: theme.color.text.secondary }]}>
          {t(CATEGORY_LABEL[me.category])}
        </Text>
      </View>

      {answered === 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('profile.accelerator.title')}. ${t('profile.accelerator.start')}`}
          onPress={() => router.push('/profile/scenarios')}
          style={styles.accelerator}
        >
          <View style={styles.sparkle}>
            <Sparkle size={22} color={theme.semantic.selection.bg} weight="fill" />
          </View>
          <View style={{ flex: 1, gap: theme.space['1'] }}>
            <Text style={[textStyle('label', locale), styles.accOverline]}>
              {t('profile.accelerator.overline')}
            </Text>
            <Text style={[textStyle('h3', locale), { color: theme.color.text.primary }]}>
              {t('profile.accelerator.title')}
            </Text>
          </View>
          <View style={styles.startButton}>
            <Text style={[textStyle('label', locale), { color: theme.color.white }]}>
              {t('profile.accelerator.start')}
            </Text>
            <ArrowRight size={16} color={theme.color.white} />
          </View>
        </Pressable>
      )}

      <View style={styles.tiles}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('profile.tiles.biodata')}. ${t('profile.complete', { percent })}`}
          onPress={() => router.push('/profile/biodata')}
          style={[styles.tile, styles.tilePrimary]}
        >
          <UserCircle size={28} color={theme.color.white} />
          <Text style={[textStyle('h2', locale), { color: theme.color.white }]}>
            {t('profile.tiles.biodata')}
          </Text>
          <Text style={[textStyle('body', locale), { color: theme.color.brand.primarySubtle }]}>
            {t('profile.tiles.biodataSub')}
          </Text>
        </Pressable>
        <Pressable
          style={styles.tile}
          testID="verification-tile"
          accessibilityRole={me.isIdentityVerified ? 'text' : 'button'}
          accessibilityLabel={[
            t('profile.tiles.verification'),
            me.isIdentityVerified ? t('profile.tiles.verified') : t('profile.tiles.notVerified'),
            ...(me.isIdentityVerified
              ? []
              : [cantVerify ? t('profile.tiles.cantVerify') : t('profile.tiles.verifySub')]),
          ].join('. ')}
          disabled={me.isIdentityVerified}
          onPress={() => router.push('/profile/verify')}
        >
          <ShieldCheck
            size={28}
            color={theme.color.brand.primary}
            weight={me.isIdentityVerified ? 'fill' : 'regular'}
          />
          <Text style={[textStyle('h2', locale), { color: theme.color.text.primary }]}>
            {t('profile.tiles.verification')}
          </Text>
          <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
            {me.isIdentityVerified ? t('profile.tiles.verified') : t('profile.tiles.notVerified')}
          </Text>
          {!me.isIdentityVerified && (
            <Text style={[textStyle('label', locale), { color: theme.color.brand.primary }]}>
              {cantVerify ? t('profile.tiles.cantVerify') : t('verification.start')}
            </Text>
          )}
        </Pressable>
      </View>

      <EmailBadgeRow />

      <PauseRow />
    </Screen>
  );
}

/**
 * The optional work/college email badge (FR-VER-05, T3.3; design M34 "DigiLocker & work email"):
 * the badges already earned, or "Add email".
 */
function EmailBadgeRow() {
  const { t, locale } = useT();
  const { me } = useMe();
  if (!me) return null;
  const earned = [
    ...(me.badges.some((b) => b.type === 'work_verified')
      ? [t('verification.email.verified.work')]
      : []),
    ...(me.badges.some((b) => b.type === 'student_verified')
      ? [t('verification.email.verified.college')]
      : []),
  ];
  const status = earned.length ? earned.join(' · ') : t('profile.tiles.emailSub');
  return (
    <Pressable
      testID="email-badge-row"
      accessibilityRole="button"
      accessibilityLabel={`${t('profile.tiles.email')}. ${status}`}
      onPress={() =>
        router.push({
          pathname: '/profile/verify-email',
          // With one badge earned, "Add email" opens the other kind.
          params:
            earned.length === 1
              ? {
                  type: me.badges.some((b) => b.type === 'work_verified')
                    ? 'college_email'
                    : 'work_email',
                }
              : {},
        })
      }
      style={({ pressed }) => [styles.emailRow, pressed && styles.emailRowPressed]}
    >
      <View style={styles.emailIcon}>
        {earned.length ? (
          <SealCheck size={22} color={theme.semantic.status.verified.fg} weight="fill" />
        ) : (
          <EnvelopeSimple size={22} color={theme.color.brand.primary} />
        )}
      </View>
      <View style={{ flex: 1, gap: theme.space['1'] }}>
        <Text style={[textStyle('label', locale), { color: theme.color.text.primary }]}>
          {t('profile.tiles.email')}
        </Text>
        <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
          {status}
        </Text>
      </View>
      {earned.length < 2 ? (
        <Text style={[textStyle('label', locale), { color: theme.color.brand.primary }]}>
          {t('profile.tiles.emailAdd')}
        </Text>
      ) : null}
      <CaretRight size={18} color={theme.color.text.secondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.bg.surface,
  },
  header: { alignItems: 'center', gap: theme.space['2'] },
  pill: {
    backgroundColor: theme.color.brand.primarySubtle,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.space['4'],
    paddingVertical: theme.space['1'],
  },
  pillText: { color: theme.color.brand.primary },
  accelerator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['3'],
    backgroundColor: theme.semantic.selection.bg,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
  },
  sparkle: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accOverline: { color: theme.color.text.primary, textTransform: 'uppercase' },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['1'],
    backgroundColor: theme.color.brand.primary,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.space['4'],
    minHeight: 44,
  },
  tiles: { flexDirection: 'row', gap: theme.space['3'] },
  tile: {
    flex: 1,
    gap: theme.space['2'],
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    minHeight: 150,
    ...theme.elevation['1'],
  },
  tilePrimary: { backgroundColor: theme.color.brand.primary },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['3'],
    minHeight: 72,
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    ...theme.elevation['1'],
  },
  emailRowPressed: { backgroundColor: theme.color.brand.primarySubtle },
  emailIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.brand.primarySubtle,
  },
});
