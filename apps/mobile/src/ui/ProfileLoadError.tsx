import { StyleSheet, Text, View } from 'react-native';
import { textStyle, theme } from '../theme';
import { useT } from '../useT';
import { SecondaryButton } from './buttons';
import { WarningCircle } from './icons';

/** Shown when GET /v1/me fails (offline, server error): the app cannot tell where the user belongs. */
export function ProfileLoadError({ onRetry }: { onRetry: () => void }) {
  const { t, locale } = useT();
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <WarningCircle size={40} color={theme.color.danger} />
      <Text style={[textStyle('h2', locale), styles.text]}>{t('common.profileLoadFailed')}</Text>
      <SecondaryButton
        locale={locale}
        label={t('common.retry')}
        trailingArrow={false}
        onPress={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space['4'],
    padding: theme.layout.screenPaddingMobile,
    backgroundColor: theme.color.bg.app,
  },
  text: { color: theme.color.text.primary, textAlign: 'center' },
});
