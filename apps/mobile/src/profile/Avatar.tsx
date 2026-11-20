import { Image, StyleSheet, Text, View } from 'react-native';
import type { Me } from '@flatrimony/shared';
import { theme } from '../theme';
import { avatarPhoto, initials } from './logic';

/**
 * The main photo (skipping photos rejected in review), or the first letter of the name on brand
 * purple. Decorative for screen readers.
 */
export function Avatar({ me, size }: { me: Me; size: number }) {
  const main = avatarPhoto(me);
  return main ? (
    <Image
      source={{ uri: main.url }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  ) : (
    <View
      style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Text style={[styles.letter, { fontSize: size * 0.4 }]}>{initials(me.displayName)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: theme.color.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { color: theme.color.white, fontFamily: 'PlusJakartaSans_800ExtraBold' },
});
