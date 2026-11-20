import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Backspace } from './icons';
import { theme } from '../theme';

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
];

interface KeypadProps {
  onKey: (key: string) => void;
  deleteLabel: string;
  /** Bottom-left slot (decorative icon, or an action such as "resend"). */
  leftSlot?: ReactNode;
  disabled?: boolean;
}

/**
 * In-app numeric keypad (docs/designs M02/M03 "secured keypad"): digits only, no system
 * keyboard, so nothing is suggested or learned by third-party keyboards. 48 dp+ targets.
 */
export function Keypad({ onKey, deleteLabel, leftSlot, disabled }: KeypadProps) {
  // Short phones (≤ 700 dp tall, e.g. 360×640): 48 dp keys, the minimum target, so the whole
  // keypad and its action button stay on screen.
  const compact = useWindowDimensions().height <= 700;
  const press = (key: string) => {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onKey(key);
  };
  return (
    <View style={[styles.grid, compact && styles.gridCompact]}>
      {KEYS.map(([digit, letters]) => (
        <Key
          key={digit}
          onPress={() => press(digit)}
          label={digit}
          testID={`key-${digit}`}
          disabled={disabled}
          compact={compact}
        >
          <Text style={styles.digit}>{digit}</Text>
          {letters ? <Text style={styles.letters}>{letters}</Text> : null}
        </Key>
      ))}
      <View style={[styles.key, compact && styles.keyCompact, styles.slot]}>{leftSlot}</View>
      <Key
        onPress={() => press('0')}
        label="0"
        testID="key-0"
        disabled={disabled}
        compact={compact}
      >
        <Text style={styles.digit}>0</Text>
        <Text style={styles.letters}>+</Text>
      </Key>
      <Key
        onPress={() => press('backspace')}
        label={deleteLabel}
        testID="key-backspace"
        disabled={disabled}
        compact={compact}
      >
        <Backspace size={26} color={theme.color.text.primary} />
      </Key>
    </View>
  );
}

function Key({
  children,
  onPress,
  label,
  testID,
  disabled,
  compact,
}: {
  children: ReactNode;
  onPress: () => void;
  label: string;
  /** Stable handle for E2E (Maestro, Playwright): `key-<digit>` / `key-backspace`. */
  testID: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        compact && styles.keyCompact,
        pressed && !disabled && { backgroundColor: theme.color.brand.primarySubtle },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.space['2'],
  },
  key: {
    width: '31.5%',
    minHeight: 54,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space['2'],
  },
  gridCompact: { rowGap: theme.space['2'] },
  keyCompact: { minHeight: 48, paddingVertical: theme.space['1'] },
  slot: { backgroundColor: 'transparent' },
  digit: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 26,
    lineHeight: 32,
    color: theme.color.text.primary,
  },
  letters: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 2,
    color: theme.color.text.secondary,
  },
});
