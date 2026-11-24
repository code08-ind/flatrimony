'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { saveErrorKey, type Draft } from '@flatrimony/client';
import type { MessageKey } from '@flatrimony/i18n';
import { Me } from '@flatrimony/shared';
import { api, NetworkError, problemCode } from './api';

/**
 * The onboarding answers not yet saved, in memory only: personal data (name, date of birth) never
 * goes to browser storage, and a reload resumes from what the server has (as on Android).
 */
let draft: Draft = {};
const listeners = new Set<() => void>();

export function updateDraft(patch: Partial<Draft>) {
  draft = { ...draft, ...patch };
  listeners.forEach((l) => l());
}
export function resetDraft() {
  draft = {};
  listeners.forEach((l) => l());
}
export const getDraft = () => draft;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const empty: Draft = {};
export const useDraft = (): Draft =>
  useSyncExternalStore(
    subscribe,
    () => draft,
    () => empty,
  );

export type SaveResult =
  { ok: true; me: Me; etag?: string } | { ok: false; error: MessageKey; status?: number };

/** A write that answers with the new Me (bootstrap, PATCH /me, the biodata PUTs). */
export async function saveMe(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown,
  locale?: 'en' | 'hi',
): Promise<SaveResult> {
  try {
    const res = await api(path, { method, body, ...(locale ? { locale } : {}) });
    if (res.status === 200 || res.status === 201) {
      const parsed = Me.safeParse(res.body);
      return parsed.success
        ? { ok: true, me: parsed.data, ...(res.etag ? { etag: res.etag } : {}) }
        : { ok: false, error: 'onboarding.errors.generic' };
    }
    const fields = (res.body as { errors?: { code?: unknown }[] } | null)?.errors ?? [];
    return {
      ok: false,
      status: res.status,
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

/** One save at a time (a double click sends one request), with busy and error state. */
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
