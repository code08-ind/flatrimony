import { useState } from 'react';
import { View } from 'react-native';
import { useMe } from '../../../src/me';
import { anchorComplete, DEFAULT_MINUTES, type AnchorDraft } from '@flatrimony/client';
import { EditScreen } from '../../../src/profile/EditScreen';
import { useProfileSave } from '../../../src/profile/save';
import { useReference } from '../../../src/profile/reference';
import { theme } from '../../../src/theme';
import { useT } from '../../../src/useT';
import { AnchorPicker } from '../../../src/ui/biodata/AnchorPicker';
import { SecondaryButton } from '../../../src/ui/buttons';
import { confirmAction } from '../../../src/ui/confirm';
import { Notice } from '../../../src/ui/Notice';

/**
 * Office or college (FR-BIO-03; PUT /me/anchor): place, travel mode and longest commute, with the
 * commute zone previewed. Saving a new place, mode or time redraws the stored zone (T2.9).
 */
export default function EditAnchor() {
  const { t, locale } = useT();
  const { me } = useMe();
  const saving = useProfileSave();
  const reference = useReference(locale);
  const [anchor, setAnchor] = useState<AnchorDraft>(
    me?.anchor
      ? { ...me.anchor }
      : {
          kind: me?.category === 'student' ? 'college' : 'office',
          travelMode: 'metro_transit',
          maxCommuteMin: DEFAULT_MINUTES,
        },
  );
  if (!me) return null;
  const saved = me.anchor;
  const dirty =
    !saved ||
    saved.kind !== anchor.kind ||
    saved.label !== anchor.label ||
    saved.location.lat !== anchor.location?.lat ||
    saved.location.lng !== anchor.location?.lng ||
    saved.travelMode !== anchor.travelMode ||
    saved.maxCommuteMin !== anchor.maxCommuteMin;

  return (
    <EditScreen
      title={t('anchor.editTitle')}
      busy={saving.busy}
      error={saving.error}
      dirty={dirty}
      saved={saving.saved}
      canSave={anchorComplete(anchor)}
      onSave={() => {
        if (!anchorComplete(anchor)) return;
        void saving.save('/me/anchor', 'PUT', {
          kind: anchor.kind,
          label: anchor.label,
          location: anchor.location,
          travelMode: anchor.travelMode,
          maxCommuteMin: anchor.maxCommuteMin,
        });
      }}
    >
      <AnchorPicker value={anchor} onChange={setAnchor} areas={reference.data?.areas ?? []} />
      {saved ? (
        // Removing it needs an area to match on instead (DELETE /me/anchor answers 409 otherwise).
        (me.preferences?.areaIds.length ?? 0) > 0 ? (
          <SecondaryButton
            locale={locale}
            label={t('anchor.remove')}
            trailingArrow={false}
            onPress={async () => {
              const sure = await confirmAction({
                title: t('anchor.removeConfirmTitle'),
                message: t('anchor.removeConfirmBody'),
                confirmLabel: t('anchor.remove'),
                cancelLabel: t('common.cancel'),
              });
              if (sure) void saving.save('/me/anchor', 'DELETE', undefined);
            }}
          />
        ) : (
          <View style={{ gap: theme.space['2'] }}>
            <Notice tone="info" locale={locale} message={t('anchor.removeNeedsAreas')} />
          </View>
        )
      ) : null}
    </EditScreen>
  );
}
