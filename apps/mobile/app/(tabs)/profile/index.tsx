import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMe } from '../../../src/me';
import { Avatar } from '../../../src/profile/Avatar';
import { PauseRow } from '../../../src/profile/PauseRow';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { ArrowRight, ShieldCheck, Sparkle, UserCircle } from '../../../src/ui/icons';
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
  const { me } = useMe();
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
            ...(me.isIdentityVerified ? [] : [t('profile.tiles.verifySub')]),
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
              {t('verification.start')}
            </Text>
          )}
        </Pressable>
      </View>

      <PauseRow />
    </Screen>
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
});
