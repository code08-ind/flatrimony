import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Locale } from '@flatrimony/i18n';
import { textStyle, theme } from '../theme';

/** Pill chip: `lime` = selection/highlight fill with dark text (never lime text on light; docs/06 §3.1). */
export function Chip({
  label,
  icon,
  tone = 'surface',
  locale,
}: {
  label: string;
  icon?: ReactNode;
  tone?: 'surface' | 'lime' | 'subtle';
  locale: Locale;
}) {
  const bg =
    tone === 'lime'
      ? theme.semantic.selection.bg
      : tone === 'subtle'
        ? theme.color.brand.primarySubtle
        : theme.color.bg.surface;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {icon}
      <Text style={[textStyle('label', locale), styles.text]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: theme.space['2'],
    paddingHorizontal: theme.space['4'],
    paddingVertical: theme.space['2'],
    borderRadius: theme.radius.full,
    ...theme.elevation['1'],
  },
  text: { color: theme.color.text.primary },
});
