import { StyleSheet, Text, View } from 'react-native';
import { Info, WarningCircle } from './icons';
import type { Locale } from '@flatrimony/i18n';
import { textStyle, theme } from '../theme';

/** Inline status message; announced to screen readers (docs/06 §12: errors announced). Icon + text, never colour alone. */
export function Notice({
  message,
  tone,
  locale,
}: {
  message: string;
  tone: 'error' | 'info';
  locale: Locale;
}) {
  const c = tone === 'error' ? theme.semantic.status.error : theme.semantic.status.info;
  const Icon = tone === 'error' ? WarningCircle : Info;
  return (
    <View
      style={[styles.box, { backgroundColor: c.bg }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon size={22} color={c.fg} weight="fill" />
      <Text style={[textStyle('body', locale), styles.text, { color: c.fg }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['3'],
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.space['5'],
    paddingVertical: theme.space['3'],
  },
  text: { flexShrink: 1 },
});
