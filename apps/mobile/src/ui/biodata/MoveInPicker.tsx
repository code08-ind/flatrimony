import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LIMITS } from '@flatrimony/shared';
import {
  monthGrid,
  presetWindow,
  tapDay,
  todayIst,
  type MoveInPreset,
} from '../../onboarding/logic';
import { textStyle, theme } from '../../theme';
import { useT } from '../../useT';
import { CaretLeft, CaretRight } from '../icons';
import { ChoiceChip, onboardingStyles, Stepper } from '../onboarding';

const PRESETS: MoveInPreset[] = ['asap', 'this_month', 'next_month', 'flexible'];

export type MoveInRange = { from?: string; to?: string };

/** Move-in window (presets + calendar) and lease length (FR-BIO-02; design M08). Controlled. */
export function MoveInPicker({
  range,
  onRange,
  lease,
  onLease,
}: {
  range: MoveInRange;
  onRange: (range: MoveInRange) => void;
  lease: number;
  onLease: (months: number) => void;
}) {
  const { t, locale } = useT();
  const today = todayIst(Date.now());
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

  return (
    <>
      <View style={onboardingStyles.chipWrap} accessibilityRole="radiogroup">
        {PRESETS.map((p) => (
          <ChoiceChip
            key={p}
            label={t(`onboarding.moveIn.${p}`)}
            selected={preset === p}
            onPress={() => {
              const w = presetWindow(p, today);
              onRange(w);
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
                  onPress={() => onRange(tapDay(range, day))}
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
          onMinus={() => onLease(Math.max(LIMITS.leaseMonths.min, lease - 1))}
          onPlus={() => onLease(Math.min(LIMITS.leaseMonths.max, lease + 1))}
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
    </>
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
