import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { monthGrid, todayIst } from '@flatrimony/client';
import { textStyle, theme } from '../theme';
import { useT } from '../useT';
import { CaretLeft, CaretRight } from '../ui/icons';

/** One date from today on (the move-in calendar of M08, for a single day). Controlled. */
export function DatePicker({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (iso: string) => void;
  label: string;
}) {
  const { t, locale } = useT();
  const today = todayIst(Date.now());
  const start = value ?? today;
  const [cursor, setCursor] = useState({
    year: Number(start.slice(0, 4)),
    month0: Number(start.slice(5, 7)) - 1,
  });
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month0), [cursor]);
  const tag = locale === 'hi' ? 'hi-IN' : 'en-IN';
  const fmt = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      day: new Intl.DateTimeFormat(tag, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    }),
    [tag],
  );
  const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const isCurrentMonth =
    cursor.year * 12 + cursor.month0 <=
    Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  const shift = (by: number) =>
    setCursor((c) => {
      const m = c.year * 12 + c.month0 + by;
      return { year: Math.floor(m / 12), month0: m % 12 };
    });

  return (
    <View style={{ gap: theme.space['2'] }} accessibilityLabel={label}>
      <View style={styles.monthRow}>
        <Text style={[textStyle('label', locale), styles.primary]}>
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
            const chosen = day === value;
            return (
              <Pressable
                key={di}
                accessibilityRole="button"
                accessibilityLabel={fmt.day.format(asDate(day))}
                accessibilityState={{ disabled: past, selected: chosen }}
                disabled={past}
                onPress={() => onChange(day)}
                style={[styles.day, chosen && styles.dayChosen]}
              >
                <Text
                  style={[
                    textStyle('body', locale),
                    styles.primary,
                    past && styles.dayPast,
                    chosen && styles.dayChosenText,
                  ]}
                >
                  {Number(day.slice(8))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      {value ? (
        <Text style={[textStyle('body', locale), styles.muted]} accessibilityLiveRegion="polite">
          {`${label}: ${fmt.day.format(asDate(value))}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  primary: { color: theme.color.text.primary },
  muted: { color: theme.color.text.secondary },
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
  dayChosen: { backgroundColor: theme.color.brand.primary, borderRadius: theme.radius.full },
  dayPast: { color: theme.color.text.disabled },
  dayChosenText: { color: theme.color.white, fontFamily: 'PlusJakartaSans_700Bold' },
});
