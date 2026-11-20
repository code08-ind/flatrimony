import { Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { useMe } from '../me';
import { useProfileSave } from './save';
import { textStyle, theme } from '../theme';
import { useT } from '../useT';
import { Notice } from '../ui/Notice';

/**
 * "Pause my profile" (FR-BIO-08): hidden from Discover, chats continue. Saves at once
 * (PATCH /me { isPaused }); the switch shows the saved state, so a failed save flips back.
 */
export function PauseRow() {
  const { t, locale } = useT();
  const { me } = useMe();
  const saving = useProfileSave();
  if (!me) return null;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[textStyle('h3', locale), { color: theme.color.text.primary }]}>
            {t('profile.pause.title')}
          </Text>
          <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
            {t('profile.pause.sub')}
          </Text>
        </View>
        <Switch
          value={me.isPaused}
          disabled={saving.busy}
          accessibilityLabel={t('profile.pause.title')}
          onValueChange={(isPaused) =>
            void saving.save('/me', 'PATCH', { isPaused }, { leave: false })
          }
          trackColor={{ false: theme.color.border.default, true: theme.color.brand.primary }}
          thumbColor={Platform.OS === 'android' ? theme.color.white : undefined}
        />
      </View>
      {me.isPaused && (
        <Text
          style={[textStyle('caption', locale), { color: theme.color.text.secondary }]}
          accessibilityLiveRegion="polite"
        >
          {t('profile.pause.paused')}
        </Text>
      )}
      {saving.error && <Notice tone="error" locale={locale} message={t(saving.error)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.lg,
    padding: theme.layout.cardPadding,
    gap: theme.space['2'],
    ...theme.elevation['1'],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] },
  text: { flex: 1, gap: theme.space['1'] },
});
