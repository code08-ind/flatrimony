import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Locale } from '@flatrimony/i18n';
import { textStyle, theme } from './theme';

/** Temporary screen body until the M2+ screens are built from docs/designs/android. */
export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language === 'hi' ? 'hi' : 'en') as Locale;
  return (
    <View style={styles.screen} accessibilityRole="summary">
      <Text style={textStyle('h1', locale)} accessibilityRole="header">
        {t(titleKey)}
      </Text>
      <Text style={[textStyle('body', locale), styles.muted]}>{t('state.comingSoon')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.color.bg.app,
    paddingHorizontal: theme.layout.screenPaddingMobile,
    paddingTop: theme.space['4'],
    paddingBottom: theme.layout.dockReserve,
    gap: theme.space['2'],
  },
  muted: { color: theme.color.text.secondary },
});
