import { useCallback, useRef, useState } from 'react';
import type { MessageKey } from '@flatrimony/i18n';
import { Me } from '@flatrimony/shared';
import { api, NetworkError, problemCode } from '../api';
import { saveErrorKey } from './errors';

export type SaveResult = { ok: true; me: Me } | { ok: false; error: MessageKey };

/** Sends a write that answers with the new Me (bootstrap, PATCH /me, the biodata PUTs). */
export async function saveMe(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH',
  body: unknown,
): Promise<SaveResult> {
  try {
    const res = await api(path, { method, body });
    if (res.status === 200 || res.status === 201) {
      const parsed = Me.safeParse(res.body);
      return parsed.success
        ? { ok: true, me: parsed.data }
        : { ok: false, error: 'onboarding.errors.generic' };
    }
    const fields = (res.body as { errors?: { code?: unknown }[] } | null)?.errors ?? [];
    return {
      ok: false,
      error: saveErrorKey(
        res.status,
        problemCode(res.body),
        fields.map((f) => String(f.code)),
      ),
    };
  } catch (err) {
    return { ok: false, error: saveErrorKey(err instanceof NetworkError ? 'network' : 500) };
  }
}

/** One save at a time (a double tap sends one request), with busy and error state for the screen. */
export function useSaving() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const run = useCallback(async (work: () => Promise<SaveResult>, onSaved: (me: Me) => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result.ok) onSaved(result.me);
      else setError(result.error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
