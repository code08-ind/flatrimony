import { useState } from 'react';
import { useMe } from '../../../src/me';
import { anchorComplete, DEFAULT_MINUTES, type AnchorDraft } from '../../../src/anchor/logic';
import { EditScreen } from '../../../src/profile/EditScreen';
import { useProfileSave } from '../../../src/profile/save';
import { useReference } from '../../../src/profile/reference';
import { useT } from '../../../src/useT';
import { AnchorPicker } from '../../../src/ui/biodata/AnchorPicker';

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
    </EditScreen>
  );
}
