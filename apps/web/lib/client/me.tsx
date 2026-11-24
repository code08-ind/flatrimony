'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { readMe } from '@flatrimony/client';
import type { Me } from '@flatrimony/shared';
import { api, problemCode } from './api';

/**
 * The signed-in user's profile (GET /v1/me). `me: null` with status 'ready' means no profile yet
 * (409 before bootstrap); 'signed_out' means the session is gone (the page sends the user to
 * sign-in).
 */
export interface MeState {
  status: 'loading' | 'ready' | 'error' | 'signed_out';
  me: Me | null;
  etag?: string;
  refresh: () => Promise<void>;
  /** Use a Me the API just returned (bootstrap, PUTs) without another round trip. */
  set: (me: Me, etag?: string) => void;
}

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<MeState, 'refresh' | 'set'>>({
    status: 'loading',
    me: null,
  });
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++latest.current;
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const res = await api('/me');
      if (seq !== latest.current) return;
      if (res.status === 200) {
        const me = readMe(res.body);
        setState(me ? { status: 'ready', me, etag: res.etag } : { status: 'error', me: null });
      } else if (res.status === 409) setState({ status: 'ready', me: null });
      else if (res.status === 401 || problemCode(res.body) === 'auth.account_deleted')
        setState({ status: 'signed_out', me: null });
      else setState({ status: 'error', me: null });
    } catch {
      if (seq === latest.current) setState({ status: 'error', me: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const set = useCallback((me: Me, etag?: string) => {
    latest.current++; // an older load must not overwrite this
    setState({ status: 'ready', me, ...(etag ? { etag } : {}) });
  }, []);

  const value = useMemo(() => ({ ...state, refresh, set }), [state, refresh, set]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const value = useContext(MeContext);
  if (!value) throw new Error('MeProvider is missing');
  return value;
}
