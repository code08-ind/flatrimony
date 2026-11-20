import { useCallback, useRef, useState } from 'react';
import type { MessageKey } from '@flatrimony/i18n';
import { Me } from '@flatrimony/shared';
import { api, NetworkError, problemCode } from '../api';
import { saveErrorKey } from './errors';

export type SaveResult =
  { ok: true; me: Me; etag?: string } | { ok: false; error: MessageKey; status?: number };

/** Sends a write that answers with the new Me (bootstrap, PATCH /me, the biodata PUTs). */
export async function saveMe(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH',
  body: unknown,
  {
    ifMatch,
    errorKey = saveErrorKey,
  }: {
    /** The ETag the edit started from (profile edits); a newer profile answers 412. */
    ifMatch?: string;
    errorKey?: typeof saveErrorKey;
  } = {},
): Promise<SaveResult> {
  try {
    const res = await api(path, { method, body, ifMatch });
    if (res.status === 200 || res.status === 201) {
      const parsed = Me.safeParse(res.body);
      return parsed.success
        ? { ok: true, me: parsed.data, etag: res.etag }
        : { ok: false, error: 'onboarding.errors.generic' };
    }
    const fields = (res.body as { errors?: { code?: unknown }[] } | null)?.errors ?? [];
    return {
      ok: false,
      status: res.status,
      error: errorKey(
        res.status,
        problemCode(res.body),
        fields.map((f) => String(f.code)),
      ),
    };
  } catch (err) {
    return { ok: false, error: errorKey(err instanceof NetworkError ? 'network' : 500) };
  }
}

/**
 * One save at a time (a double tap sends one request), with busy and error state for the screen.
 * `run` resolves true when the save went through.
 */
export function useSaving() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const run = useCallback(
    async (
      work: () => Promise<SaveResult>,
      onSaved: (me: Me, etag?: string) => void,
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await work();
        if (result.ok) onSaved(result.me, result.etag);
        else setError(result.error);
        return result.ok;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );
  return { busy, error, setError, run };
}
