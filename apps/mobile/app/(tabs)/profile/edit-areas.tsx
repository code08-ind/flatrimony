import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useMe } from '../../../src/me';
import { todayIst } from '../../../src/onboarding/logic';
import { EditScreen } from '../../../src/profile/EditScreen';
import { moveInWindowOver, preferencesWith, sameSet } from '../../../src/profile/logic';
import { useProfileSave } from '../../../src/profile/save';
import { theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { AreaPicker } from '../../../src/ui/biodata/AreaPicker';
import { SecondaryButton } from '../../../src/ui/buttons';
import { Notice } from '../../../src/ui/Notice';

/**
 * Areas: up to 3 preferred areas (FR-BIO-02; PUT /me/preferences). Office/college with commute
 * zones arrives with T2.8/T2.9. At least one area is kept while there is no anchor. The PUT sends
 * the saved move-in window too, so once it has ended the dates must be updated first.
 */
export default function EditAreas() {
  const { t, locale } = useT();
  const { me } = useMe();
  const saving = useProfileSave();
  const [selected, setSelected] = useState<number[]>(me?.preferences?.areaIds ?? []);
  if (!me || !me.preferences) return null;
  const prefs = me.preferences;
  const windowOver = moveInWindowOver(prefs, todayIst(Date.now()));

  return (
    <EditScreen
      title={t('profile.editor.areas')}
      subtitle={`${t('onboarding.commute.subtitle')} ${t('profile.editor.areasMore')}`}
      busy={saving.busy}
      error={saving.error}
      dirty={!sameSet(selected, prefs.areaIds)}
      saved={saving.saved}
      canSave={!windowOver && (selected.length > 0 || !!me.anchor)}
      onSave={() =>
        void saving.save('/me/preferences', 'PUT', preferencesWith(prefs, { areaIds: selected }))
      }
    >
      {windowOver && (
        <View style={{ gap: theme.space['3'] }}>
          <Notice tone="info" locale={locale} message={t('profile.editor.windowOver')} />
          <SecondaryButton
            locale={locale}
            label={t('profile.editor.updateDates')}
            onPress={() => router.replace('/profile/edit-budget')}
          />
        </View>
      )}
      <AreaPicker selected={selected} onChange={setSelected} />
    </EditScreen>
  );
}
