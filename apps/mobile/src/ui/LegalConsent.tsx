import { Linking, StyleSheet, Text } from 'react-native';
import type { Locale } from '@flatrimony/i18n';
import { textStyle, theme } from '../theme';
import { parseRich } from '../rich-text';

/**
 * "By continuing you agree to our Terms and Privacy Policy" with tappable links (FR-AUTH-09 shows
 * the full consent flow in onboarding). The legal pages are drafts pending lawyer review (T0.15);
 * their URLs come from config once published.
 */
export function LegalConsent({
  text,
  locale,
  termsUrl,
  privacyUrl,
}: {
  text: string;
  locale: Locale;
  termsUrl: string;
  privacyUrl: string;
}) {
  return (
    <Text style={[textStyle('caption', locale), styles.text]}>
      {parseRich(text, ['terms', 'privacy']).map((part, i) =>
        part.tag ? (
          <Text
            key={i}
            accessibilityRole="link"
            style={styles.link}
            onPress={() => void Linking.openURL(part.tag === 'terms' ? termsUrl : privacyUrl)}
          >
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { color: theme.color.text.secondary, textAlign: 'center' },
  link: {
    color: theme.color.text.primary,
    textDecorationLine: 'underline',
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
});
