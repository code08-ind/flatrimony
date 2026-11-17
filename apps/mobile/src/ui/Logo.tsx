import { StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { theme } from '../theme';
import { LOGO_MARK_SVG } from './logo-mark';

/** Logo mark + wordmark (docs/06 §2.2): Plus Jakarta Sans ExtraBold, −3% tracking. */
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="Flatrimony">
      <SvgXml xml={LOGO_MARK_SVG} width={size} height={size} />
      <Text style={[styles.word, { fontSize: size * 0.9, lineHeight: size * 1.05 }]}>
        Flatrimony
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] },
  word: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: theme.color.text.primary,
    letterSpacing: -1.2,
  },
});
