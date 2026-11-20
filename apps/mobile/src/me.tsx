import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Me } from '@flatrimony/shared';
import { api, problemCode } from './api';
import { useSession } from './auth/session';
import { resetDraft } from './onboarding/draft';
import { readMe } from './me-parse';
import { supabase } from './supabase';

/**
 * The signed-in user's profile (GET /v1/me), shared by the tab and onboarding layouts to decide
 * where the user belongs. `me: null` with status 'ready' means no profile yet (409 before bootstrap).
 */
export interface MeState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  me: Me | null;
  /** The profile version (ETag) `me` was read at; sent as If-Match by profile edits. */
  etag?: string;
  /**
   * Loads the profile again. `quiet` (after an edit elsewhere on the screen) keeps the current
   * profile and status on failure instead of showing the load error; it resolves true on success.
   */
  refresh: (options?: { quiet?: boolean }) => Promise<boolean>;
  /** Use a Me the API just returned (bootstrap, PUTs) without another round trip. */
  set: (me: Me, etag?: string) => void;
}

const MeContext = createContext<MeState>({
  status: 'idle',
  me: null,
  refresh: async () => false,
  set: () => {},
});

export function MeProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<Omit<MeState, 'refresh' | 'set'>>({
    status: 'idle',
    me: null,
  });
  // Every load gets a number; only the newest may write (a late answer for a previous user or an
  // older request must not win).
  const latest = useRef(0);

  const refresh = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      const seq = ++latest.current;
      if (!userId) {
        setState({ status: 'idle', me: null });
        return false;
      }
      if (!quiet) setState((s) => ({ ...s, status: 'loading' }));
      try {
        const res = await api('/me');
        if (seq !== latest.current) return false;
        if (res.status === 200) {
          const me = readMe(res.body);
          if (me) {
            setState({ status: 'ready', me, etag: res.etag });
            return true;
          }
          if (!quiet) setState({ status: 'error', me: null });
        } else if (res.status === 409) setState({ status: 'ready', me: null });
        else if (res.status === 401 || problemCode(res.body) === 'auth.account_deleted') {
          // The session is no longer valid (or the account is gone): sign out instead of retrying.
          await supabase?.auth.signOut().catch(() => {});
        } else if (!quiet) setState({ status: 'error', me: null });
      } catch {
        if (seq === latest.current && !quiet) setState({ status: 'error', me: null });
      }
      return false;
    },
    [userId],
  );

  // A different user (or none): forget the previous profile and the unsaved onboarding answers
  // before loading, so nothing of one person can reach another's screens.
  useEffect(() => {
    resetDraft();
    setState({ status: 'idle', me: null });
    void refresh();
  }, [refresh]);

  const set = useCallback((me: Me, etag?: string) => {
    latest.current += 1; // a save's answer is newer than any load still in flight
    setState({ status: 'ready', me, etag });
  }, []);

  return <MeContext.Provider value={{ ...state, refresh, set }}>{children}</MeContext.Provider>;
}

export const useMe = () => useContext(MeContext);
