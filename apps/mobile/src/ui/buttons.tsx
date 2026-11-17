import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, ArrowRight } from './icons';
import type { Locale } from '@flatrimony/i18n';
import { textStyle, theme } from '../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  locale: Locale;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  trailingArrow?: boolean;
  testID?: string;
}

/** Full-width pill, 56 high on mobile (docs/06 §3.3). At most one primary per screen. */
export function PrimaryButton({
  label,
  onPress,
  locale,
  disabled,
  busy,
  icon,
  trailingArrow = true,
  testID,
}: ButtonProps) {
  const inactive = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles.primary,
        pressed && !inactive && { backgroundColor: theme.color.brand.primaryPressed },
        inactive && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={theme.semantic.action.primary.fg} />
      ) : (
        <View style={styles.inner}>
          {icon}
          <Text style={[textStyle('h3', locale), styles.primaryText]}>{label}</Text>
          {trailingArrow && <ArrowRight size={22} color={theme.semantic.action.primary.fg} />}
        </View>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  locale,
  disabled,
  icon,
  trailingArrow = true,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles.secondary,
        pressed && { backgroundColor: theme.color.brand.primarySubtle },
      ]}
    >
      <View style={styles.inner}>
        {icon}
        <Text style={[textStyle('h3', locale), styles.secondaryText]}>{label}</Text>
        {trailingArrow && <ArrowRight size={22} color={theme.semantic.action.secondary.fg} />}
      </View>
    </Pressable>
  );
}

export function BackButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.back,
        pressed && { backgroundColor: theme.color.brand.primarySubtle },
      ]}
    >
      <ArrowLeft size={24} color={theme.color.text.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: theme.size.button.primaryMobileFullWidth,
    borderRadius: theme.radius.full,
    justifyContent: 'center',
    paddingHorizontal: theme.space['6'],
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space['3'],
    justifyContent: 'center',
  },
  primary: { backgroundColor: theme.semantic.action.primary.bg, ...theme.elevation['2'] },
  primaryText: { color: theme.semantic.action.primary.fg, flexShrink: 1, textAlign: 'center' },
  secondary: {
    backgroundColor: theme.semantic.action.secondary.bg,
    borderWidth: theme.borderWidth.default,
    borderColor: theme.color.border.default,
  },
  secondaryText: { color: theme.semantic.action.secondary.fg, flexShrink: 1, textAlign: 'center' },
  disabled: { opacity: 0.5 },
  back: {
    width: theme.size.touchMin,
    height: theme.size.touchMin,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.elevation['1'],
  },
});
