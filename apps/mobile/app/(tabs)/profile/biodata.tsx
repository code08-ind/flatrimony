import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import type { ImportanceMap } from '@flatrimony/shared';
import { useMe } from '../../../src/me';
import { formatInr } from '../../../src/onboarding/logic';
import { Avatar } from '../../../src/profile/Avatar';
import { useUnsavedChangesGuard } from '../../../src/profile/EditScreen';
import {
  habitLabels,
  languageName,
  IMPORTANCE_ATTRIBUTES,
  IMPORTANCE_LEVELS,
  importanceDirty,
  importanceKey,
  importanceOf,
  importanceToSave,
  sameImportance,
} from '../../../src/profile/logic';
import { PauseRow } from '../../../src/profile/PauseRow';
import { useReference } from '../../../src/profile/reference';
import { useProfileSave } from '../../../src/profile/save';
import { textStyle, theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { BackButton, PrimaryButton, SecondaryButton } from '../../../src/ui/buttons';
import { Chip } from '../../../src/ui/Chip';
import { Notice } from '../../../src/ui/Notice';
import { Screen } from '../../../src/ui/Screen';

/**
 * M35 Flat Biodata editor (docs/06 §8.13; FR-BIO-01..08): one card per part with an edit button,
 * importance set inline, photos and pause. Each part saves through its own endpoint (T2.5/T2.7/
 * T2.10); the button at the bottom saves the importance choices.
 */
export default function BiodataEditor() {
  const { t, locale } = useT();
  const { me } = useMe();
  const saving = useProfileSave();
  const reference = useReference(locale);
  const [importance, setImportance] = useState<ImportanceMap>(me?.importance ?? {});
  const [savedNote, setSavedNote] = useState(false);
  // Reset the choices only when the saved levels really change (a save here, or the latest profile
  // after a 412), not on every new Me object (Pause, photo or section saves).
  const savedKey = importanceKey(me?.importance ?? {});
  useEffect(() => {
    if (me) setImportance(me.importance);
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the saved levels
  const changed = !!me && !sameImportance(importance, me.importance);
  useUnsavedChangesGuard(changed);
  if (!me) return null;

  const dirty = importanceDirty(importance, me.importance);
  const fmtDay = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const day = (iso: string) => fmtDay.format(new Date(`${iso}T00:00:00Z`));
  const areaNames = (me.preferences?.areaIds ?? [])
    .map((id) => reference.data?.areas.find((a) => a.id === id)?.name)
    .filter((n): n is string => !!n);
  const totalScenarios = reference.data?.scenarioQuestions.length ?? 0;
  const answered = me.scenarioAnswers?.length ?? 0;

  const save = () =>
    void saving
      .save('/me/importance', 'PUT', importanceToSave(importance), { leave: false })
      .then((ok) => setSavedNote(ok));

  return (
    <Screen
      footer={
        dirty ? (
          <PrimaryButton
            testID="save-importance"
            locale={locale}
            label={t('profile.editor.saveChanges')}
            busy={saving.busy}
            onPress={save}
          />
        ) : undefined
      }
    >
      <View style={styles.titleRow}>
        <BackButton label={t('common.back')} onPress={() => router.dismissTo('/profile')} />
        <Text style={textStyle('h1', locale)} accessibilityRole="header">
          {t('profile.editor.title')}
        </Text>
      </View>

      <View style={[styles.card, styles.summary]}>
        <Avatar me={me} size={64} />
        <View style={{ flex: 1, gap: theme.space['2'] }}>
          <Text style={[textStyle('h2', locale), { color: theme.color.text.primary }]}>
            {me.displayName}
          </Text>
          <View
            style={styles.bar}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('profile.complete', { percent: me.biodataCompletion })}
            accessibilityValue={{ min: 0, max: 100, now: me.biodataCompletion }}
          >
            <View style={[styles.barFill, { width: `${me.biodataCompletion}%` }]} />
          </View>
          <Text style={[textStyle('label', locale), { color: theme.color.brand.primary }]}>
            {t('profile.complete', { percent: me.biodataCompletion })}
          </Text>
        </View>
      </View>

      <Section title={t('profile.editor.basics')} href="/profile/edit-basics">
        <Text style={[textStyle('bodyLg', locale), styles.strong]}>
          {[
            me.age !== null
              ? t('profile.nameAge', { name: me.displayName, age: me.age })
              : me.displayName,
            ...me.languages.map((l) => languageName(t, l)),
          ].join(' · ')}
        </Text>
        <Text style={[textStyle('body', locale), styles.muted]}>
          {me.bio ?? t('profile.editor.noBio')}
        </Text>
      </Section>

      <Section title={t('profile.editor.budgetDates')} href="/profile/edit-budget">
        {me.preferences ? (
          <>
            <Text style={[textStyle('bodyLg', locale), styles.strong]}>
              {formatInr(me.preferences.budgetMinInr)}–{formatInr(me.preferences.budgetMaxInr)} ·{' '}
              {day(me.preferences.moveInFrom)}–{day(me.preferences.moveInTo)}
            </Text>
            <Text style={[textStyle('body', locale), styles.muted]}>
              {t('profile.editor.lease', { months: me.preferences.leaseMonths })}
            </Text>
          </>
        ) : (
          <Text style={[textStyle('body', locale), styles.muted]}>
            {t('profile.editor.notSet')}
          </Text>
        )}
      </Section>

      <Section title={t('anchor.editTitle')} href="/profile/edit-anchor">
        {me.anchor ? (
          <>
            <Text style={[textStyle('bodyLg', locale), styles.strong]}>{me.anchor.label}</Text>
            <Text style={[textStyle('body', locale), styles.muted]}>
              {t('anchor.summary', {
                mode: t(`anchor.modes.${me.anchor.travelMode}`),
                n: me.anchor.maxCommuteMin,
              })}
            </Text>
          </>
        ) : (
          <Text style={[textStyle('body', locale), styles.muted]}>{t('anchor.notSet')}</Text>
        )}
      </Section>

      <Section title={t('profile.editor.areas')} href="/profile/edit-areas">
        {(me.preferences?.areaIds.length ?? 0) > 0 && reference.failed ? (
          <View style={{ gap: theme.space['2'] }}>
            <Text style={[textStyle('body', locale), styles.muted]}>
              {t('profile.editor.areasLoadFailed')}
            </Text>
            <SecondaryButton
              locale={locale}
              label={t('profile.scenarios.retry')}
              trailingArrow={false}
              onPress={() => void reference.retry()}
            />
          </View>
        ) : (me.preferences?.areaIds.length ?? 0) > 0 && !reference.data ? (
          <ActivityIndicator
            color={theme.color.brand.primary}
            accessibilityLabel={t('profile.editor.areas')}
          />
        ) : areaNames.length ? (
          <View style={styles.chips}>
            {areaNames.map((n) => (
              <Chip key={n} label={n} tone="subtle" locale={locale} />
            ))}
          </View>
        ) : (
          <Text style={[textStyle('body', locale), styles.muted]}>
            {t('profile.editor.noAreas')}
          </Text>
        )}
      </Section>

      <Section title={t('profile.editor.habits')} href="/profile/edit-habits">
        {me.lifestyle ? (
          <View style={styles.chips}>
            {habitLabels(me.lifestyle).map((h, i) => (
              <Chip
                key={i}
                label={`${t(h.attribute)}: ${h.key ? t(h.key) : h.text!}`}
                tone="lime"
                locale={locale}
              />
            ))}
          </View>
        ) : (
          <Text style={[textStyle('body', locale), styles.muted]}>
            {t('profile.editor.notSet')}
          </Text>
        )}
      </Section>

      <View style={styles.card}>
        <Text style={[textStyle('h2', locale), styles.strong]} accessibilityRole="header">
          {t('profile.editor.importanceTitle')}
        </Text>
        <Text style={[textStyle('body', locale), styles.muted]}>
          {t('profile.editor.importanceSub')}
        </Text>
        {IMPORTANCE_ATTRIBUTES.map((attr) => (
          <View
            key={attr}
            style={{ gap: theme.space['2'] }}
            accessibilityRole="radiogroup"
            accessibilityLabel={t(`profile.attributes.${attr}`)}
          >
            <Text style={[textStyle('label', locale), styles.strong]}>
              {t(`profile.attributes.${attr}`)}
            </Text>
            <View style={styles.segment}>
              {IMPORTANCE_LEVELS.map((level) => {
                const on = importanceOf(importance, attr) === level;
                return (
                  <Pressable
                    key={level}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    aria-checked={on}
                    accessibilityLabel={t(`profile.editor.${level}`)}
                    onPress={() => {
                      setSavedNote(false);
                      setImportance((m) => ({ ...m, [attr]: level }));
                    }}
                    style={[styles.segmentItem, on && styles.segmentOn]}
                  >
                    <Text
                      style={[
                        textStyle('caption', locale),
                        {
                          color: on ? theme.color.white : theme.color.text.primary,
                          textAlign: 'center',
                        },
                      ]}
                      numberOfLines={2}
                      textBreakStrategy="balanced"
                    >
                      {t(`profile.editor.${level}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {savedNote && !dirty && (
          <Notice tone="info" locale={locale} message={t('profile.editor.saved')} />
        )}
        {saving.error && <Notice tone="error" locale={locale} message={t(saving.error)} />}
      </View>

      <Section title={t('profile.editor.scenarios')} href="/profile/scenarios">
        {reference.data ? (
          <Text style={[textStyle('bodyLg', locale), styles.strong]}>
            {t('profile.editor.scenariosCount', {
              answered,
              total: Math.max(totalScenarios, answered),
            })}
          </Text>
        ) : (
          <Text style={[textStyle('body', locale), styles.muted]}>
            {t('profile.scenarios.subtitle')}
          </Text>
        )}
      </Section>

      <Section title={t('profile.editor.photos')} href="/profile/photos">
        {me.photos.length ? (
          <View style={styles.photos}>
            {me.photos.map((p) => (
              <Image
                key={p.id}
                source={{ uri: p.url }}
                style={styles.thumb}
                accessibilityIgnoresInvertColors
                accessible={false}
              />
            ))}
          </View>
        ) : (
          <Text style={[textStyle('body', locale), styles.muted]}>{t('profile.photos.hint')}</Text>
        )}
      </Section>

      <PauseRow />
    </Screen>
  );
}

function Section({ title, href, children }: { title: string; href: Href; children: ReactNode }) {
  const { t, locale } = useT();
  return (
    <View style={styles.card}>
      <View style={styles.sectionHead}>
        <Text style={[textStyle('h2', locale), styles.strong]} accessibilityRole="header">
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.editor.edit', { section: title })}
          onPress={() => router.push(href)}
          style={styles.editButton}
          hitSlop={4}
        >
          <Text style={[textStyle('label', locale), { color: theme.color.brand.primary }]}>
            {t('profile.editor.editShort')}
          </Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] },
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['3'],
    ...theme.elevation['1'],
  },
  summary: { flexDirection: 'row', alignItems: 'center', gap: theme.space['4'] },
  bar: {
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primarySubtle,
    overflow: 'hidden',
  },
  barFill: { height: 8, backgroundColor: theme.color.brand.primary },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editButton: {
    minHeight: theme.size.touchMin,
    paddingHorizontal: theme.space['4'],
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strong: { color: theme.color.text.primary },
  muted: { color: theme.color.text.secondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.color.bg.app,
    borderRadius: theme.radius.full,
    padding: theme.space['1'],
  },
  segmentItem: {
    flex: 1,
    minHeight: theme.size.touchMin,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space['1'],
    paddingVertical: theme.space['1'],
  },
  segmentOn: { backgroundColor: theme.color.brand.primary },
  photos: { flexDirection: 'row', gap: theme.space['2'], flexWrap: 'wrap' },
  thumb: { width: 88, height: 110, borderRadius: theme.radius.md },
});
