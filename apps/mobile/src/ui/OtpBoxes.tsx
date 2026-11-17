import { useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '../theme';

interface OtpBoxesProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  invalid?: boolean;
}

/**
 * Six code boxes over one hidden TextInput. The input carries the Android/iOS one-time-code
 * autofill hints; tapping the boxes focuses it and opens the system keyboard, whose suggestion
 * strip can offer the code from the SMS (and a hardware keyboard can type). Digits from the in-app
 * keypad update the same value. The boxes are decorative for screen readers (the input is labelled).
 */
export function OtpBoxes({ value, onChange, label, invalid }: OtpBoxesProps) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  return (
    <View style={styles.wrap}>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 6))}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        keyboardType="number-pad"
        maxLength={6}
        accessibilityLabel={label}
        style={styles.hidden}
        caretHidden
      />
      <Pressable
        onPress={() => input.current?.focus()}
        style={styles.row}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {digits.map((d, i) => {
          const filled = d !== ' ';
          const active = i === value.length;
          return (
            <View
              key={i}
              style={[
                styles.box,
                filled && styles.filled,
                active && styles.active,
                invalid && filled && { borderColor: theme.color.danger },
              ]}
            >
              <Text style={styles.digit}>{filled ? d : active ? '' : '•'}</Text>
            </View>
          );
        })}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  hidden: { position: 'absolute', opacity: 0.01, width: 1, height: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  box: {
    width: '15%',
    aspectRatio: 0.82,
    borderRadius: theme.radius.full,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: theme.color.bg.app,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: { backgroundColor: theme.color.brand.primarySubtle },
  active: { borderColor: theme.color.brand.primary, backgroundColor: theme.color.bg.surface },
  digit: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 26, color: theme.color.text.primary },
});
