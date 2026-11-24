import { useSyncExternalStore } from 'react';
import type { Draft } from '@flatrimony/client';

/**
 * The onboarding answers not yet saved, in memory only (like the pending sign-in): personal data
 * stays off the device's storage, and an app restart simply resumes from what the server has.
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

export function useDraft(): Draft {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => draft,
  );
}
