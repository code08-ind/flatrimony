import { useCallback, useState } from 'react';
import { useMe } from '../me';
import { saveMe, useSaving } from '../onboarding/save';
import { profileSaveErrorKey } from './logic';

/**
 * Saves a profile edit with If-Match (docs/05 §6.2), so an edit made from an older copy of the
 * profile cannot silently undo a newer change from another device. On 412 the latest profile is
 * loaded and the screen asks the user to check and save again. `saved` turns true after a
 * successful save (EditScreen then leaves).
 */
export function useProfileSave() {
  const { etag, set, refresh } = useMe();
  const saving = useSaving();
  const [saved, setSaved] = useState(false);
  const { run } = saving;
  const save = useCallback(
    (
      path: string,
      method: 'PUT' | 'PATCH',
      body: unknown,
      /** false keeps `saved` unchanged (a save on the editor itself, which stays open). */
      { leave = true }: { leave?: boolean } = {},
    ): Promise<boolean> =>
      run(
        async () => {
          const result = await saveMe(path, method, body, {
            ifMatch: etag,
            errorKey: profileSaveErrorKey,
          });
          if (!result.ok && result.status === 412) await refresh({ quiet: true });
          return result;
        },
        (me, newEtag) => {
          set(me, newEtag);
          if (leave) setSaved(true);
        },
      ),
    [run, etag, set, refresh],
  );
  return { ...saving, save, saved };
}
