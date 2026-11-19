import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LIMITS } from '@flatrimony/shared';
import { useMe } from '../../src/me';
import { getDraft, updateDraft, useDraft } from '../../src/onboarding/draft';
import {
  monthGrid,
  preferencesBody,
  presetWindow,
  stepNumber,
  tapDay,
  todayIst,
  type MoveInPreset,
} from '../../src/onboarding/logic';
import { saveMe, useSaving } from '../../src/onboarding/save';
import { textStyle, theme } from '../../src/theme';
import { useT } from '../../src/useT';
import { PrimaryButton } from '../../src/ui/buttons';
import { CaretLeft, CaretRight } from '../../src/ui/icons';
import { Notice } from '../../src/ui/Notice';
import { ChoiceChip, onboardingStyles, StepHeader, Stepper } from '../../src/ui/onboarding';
import { Screen } from '../../src/ui/Screen';

const PRESETS: MoveInPreset[] = ['asap', 'this_month', 'next_month', 'flexible'];

/** M08 Step 5: move-in window and lease length (FR-BIO-02). Saves the preferences. */
export default function MoveInScreen() {
  const { t, locale } = useT();
  const draft = useDraft();
  const { me, set } = useMe();
  const saving = useSaving();
  const today = todayIst(Date.now());
  const step = stepNumber('move-in');

  const [range, setRange] = useState<{ from?: string; to?: string }>({
    from: draft.moveInFrom ?? me?.preferences?.moveInFrom,
    to: draft.moveInTo ?? me?.preferences?.moveInTo,
  });
  const [lease, setLease] = useState(
    draft.leaseMonths ?? me?.preferences?.leaseMonths ?? LIMITS.leaseMonths.default,
  );
  const start = range.from ?? today;
  const [cursor, setCursor] = useState({
    year: Number(start.slice(0, 4)),
    month0: Number(start.slice(5, 7)) - 1,
  });
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month0), [cursor]);
  const fmt = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      day: new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    }),
    [locale],
  );
  const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
  // No paging into months that have already passed (a saved window may open on an earlier month).
  const isCurrentMonth =
    cursor.year * 12 + cursor.month0 <=
    Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  const preset = PRESETS.find((p) => {
    const w = presetWindow(p, today);
    return w.from === range.from && w.to === range.to;
  });
  const complete = !!range.from && !!range.to;

  const shift = (delta: number) =>
    setCursor(({ year, month0 }) => {
      const m = month0 + delta;
      return { year: year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 };
    });

  const save = () => {
    if (!complete) return;
    updateDraft({ moveInFrom: range.from, moveInTo: range.to, leaseMonths: lease });
    const body = preferencesBody(getDraft(), me?.category ?? 'professional', me?.preferences);
    // Lost earlier answers (restart): resume from the first missing step.
    if (!body || !me) return router.replace('/onboarding');
    void saving.run(
      () => saveMe('/me/preferences', 'PUT', body),
      (saved) => {
        set(saved);
        router.push('/onboarding/habits');
      },
    );
  };

  return (
    <Screen
      footer={
        <PrimaryButton
          testID="continue"
          locale={locale}
          label={t('onboarding.continue')}
          disabled={!complete}
          busy={saving.busy}
          onPress={save}
        />
      }
    >
      <StepHeader
        step={step}
        stepLabel={t('onboarding.stepOf', { n: step })}
        overline={`${t('onboarding.stepOf', { n: step })} · ${t('onboarding.moveIn.overline')}`}
        title={t('onboarding.moveIn.title')}
        subtitle={t('onboarding.moveIn.subtitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/commute'))}
        backLabel={t('common.back')}
        locale={locale}
      />

      <View style={onboardingStyles.chipWrap} accessibilityRole="radiogroup">
        {PRESETS.map((p) => (
          <ChoiceChip
            key={p}
            label={t(`onboarding.moveIn.${p}`)}
            selected={preset === p}
            onPress={() => {
              const w = presetWindow(p, today);
              setRange(w);
              setCursor({
                year: Number(w.from.slice(0, 4)),
                month0: Number(w.from.slice(5, 7)) - 1,
              });
            }}
            locale={locale}
          />
        ))}
      </View>

      <View style={onboardingStyles.card}>
        <View style={styles.monthRow}>
          <Text
            style={[textStyle('h2', locale), { color: theme.color.text.primary }]}
            accessibilityRole="header"
          >
            {fmt.month.format(new Date(Date.UTC(cursor.year, cursor.month0, 1)))}
          </Text>
          <View style={styles.navRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.moveIn.previousMonth')}
              accessibilityState={{ disabled: isCurrentMonth }}
              disabled={isCurrentMonth}
              onPress={() => shift(-1)}
              style={[styles.nav, isCurrentMonth && styles.navOff]}
            >
              <CaretLeft size={20} color={theme.color.text.primary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.moveIn.followingMonth')}
              onPress={() => shift(1)}
              style={styles.nav}
            >
              <CaretRight size={20} color={theme.color.text.primary} />
            </Pressable>
          </View>
        </View>
        <View style={styles.week}>
          {t('onboarding.moveIn.weekdays')
            .split(',')
            .map((d, i) => (
              <Text
                key={i}
                style={[textStyle('caption', locale), styles.weekday]}
                importantForAccessibility="no"
              >
                {d}
              </Text>
            ))}
        </View>
        {weeks.map((week, wi) => (
          <View key={wi} style={styles.week}>
            {week.map((day, di) => {
              if (!day) return <View key={di} style={styles.day} />;
              const past = day < today;
              const edge = day === range.from || day === range.to;
              const inside = !!range.from && !!range.to && day > range.from && day < range.to;
              return (
                <Pressable
                  key={di}
                  accessibilityRole="button"
                  accessibilityLabel={fmt.day.format(asDate(day))}
                  accessibilityState={{ disabled: past, selected: edge || inside }}
                  disabled={past}
                  onPress={() => setRange((w) => tapDay(w, day))}
                  style={[styles.day, inside && styles.dayInside, edge && styles.dayEdge]}
                >
                  <Text
                    style={[
                      textStyle('body', locale),
                      styles.dayText,
                      past && styles.dayPast,
                      edge && styles.dayEdgeText,
                    ]}
                  >
                    {Number(day.slice(8))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        <Text
          style={[textStyle('body', locale), { color: theme.color.text.secondary }]}
          accessibilityLiveRegion="polite"
        >
          {complete
            ? `${t('onboarding.moveIn.window')}: ${t('onboarding.moveIn.windowValue', {
                from: fmt.day.format(asDate(range.from!)),
                to: fmt.day.format(asDate(range.to!)),
              })}`
            : range.from
              ? t('onboarding.moveIn.pickEnd')
              : t('onboarding.moveIn.pickStart')}
        </Text>
      </View>

      <View style={onboardingStyles.card}>
        <Stepper
          label={t('onboarding.moveIn.lease')}
          value={String(lease)}
          onMinus={() => setLease((l) => Math.max(LIMITS.leaseMonths.min, l - 1))}
          onPlus={() => setLease((l) => Math.min(LIMITS.leaseMonths.max, l + 1))}
          minusLabel={t('onboarding.moveIn.fewerMonths')}
          plusLabel={t('onboarding.moveIn.moreMonths')}
          canMinus={lease > LIMITS.leaseMonths.min}
          canPlus={lease < LIMITS.leaseMonths.max}
          locale={locale}
        />
        <Text style={[textStyle('caption', locale), { color: theme.color.text.secondary }]}>
          {t('onboarding.moveIn.leaseHint')}
        </Text>
      </View>

      {saving.error && <Notice tone="error" locale={locale} message={t(saving.error)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  navRow: { flexDirection: 'row', gap: theme.space['2'] },
  nav: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.bg.app,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navOff: { opacity: 0.35 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: theme.color.text.secondary },
  day: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
  dayInside: { backgroundColor: theme.color.brand.primarySubtle },
  dayEdge: { backgroundColor: theme.color.brand.primary, borderRadius: theme.radius.full },
  dayText: { color: theme.color.text.primary },
  dayPast: { color: theme.color.text.disabled },
  dayEdgeText: { color: theme.color.white, fontFamily: 'PlusJakartaSans_700Bold' },
});
