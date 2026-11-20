import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, usePreventRemove } from 'expo-router';
import type { MessageKey } from '@flatrimony/i18n';
import { textStyle, theme } from '../theme';
import { useT } from '../useT';
import { BackButton, PrimaryButton } from '../ui/buttons';
import { confirmAction } from '../ui/confirm';
import { Notice } from '../ui/Notice';
import { Screen } from '../ui/Screen';

/**
 * Shell of a Flat Biodata edit screen: back, title, the form, and Save pinned at the bottom. Save is
 * enabled only when something changed (`dirty`) and the form is valid (`canSave`). Leaving with
 * unsaved changes (back button, Android back, another tab) asks first (docs/06 §9). After a
 * successful save (`saved`) it goes back to the editor.
 */
export function EditScreen({
  title,
  subtitle,
  onSave,
  busy,
  error,
  dirty,
  saved,
  canSave = true,
  children,
}: {
  title: string;
  subtitle?: string;
  onSave: () => void;
  busy: boolean;
  error: MessageKey | null;
  dirty: boolean;
  saved: boolean;
  canSave?: boolean;
  children: ReactNode;
}) {
  const { t, locale } = useT();
  useUnsavedChangesGuard(dirty && !saved);
  useEffect(() => {
    if (saved) leaveEditor();
  }, [saved]);
  return (
    <Screen
      footer={
        <>
          {error && <Notice tone="error" locale={locale} message={t(error)} />}
          <PrimaryButton
            testID="save"
            locale={locale}
            label={t('profile.editor.save')}
            trailingArrow={false}
            disabled={!dirty || !canSave}
            busy={busy}
            onPress={onSave}
          />
        </>
      }
    >
      <View style={styles.titleRow}>
        <BackButton label={t('common.back')} onPress={leaveEditor} />
        <Text style={[textStyle('h1', locale), styles.title]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {subtitle ? (
        <Text style={[textStyle('body', locale), { color: theme.color.text.secondary }]}>
          {subtitle}
        </Text>
      ) : null}
      {children}
    </Screen>
  );
}

/** While `unsaved`, leaving the screen asks "Discard your changes?" first. */
export function useUnsavedChangesGuard(unsaved: boolean) {
  const { t } = useT();
  const [discarded, setDiscarded] = useState(false);
  usePreventRemove(unsaved && !discarded, ({ repeat }) => {
    void confirmAction({
      title: t('profile.editor.discardTitle'),
      message: t('profile.editor.discardBody'),
      confirmLabel: t('profile.editor.discard'),
      cancelLabel: t('profile.editor.keepEditing'),
    }).then((discard) => {
      if (!discard) return;
      setDiscarded(true);
      repeat();
    });
  });
}

/**
 * Back to the Flat Biodata editor. `dismissTo` pops to it when it is in the stack and replaces this
 * screen otherwise (a deep link or a web reload), so it never falls through to another tab.
 */
export const leaveEditor = () => router.dismissTo('/profile/biodata');

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] },
  title: { flex: 1 },
});
