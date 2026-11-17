import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

interface SessionState {
  session: Session | null;
  loading: boolean;
}

const SessionContext = createContext<SessionState>({ session: null, loading: true });

/** Tracks the Supabase session (restored from secure storage on launch). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: !!supabase });

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const auth = supabase.auth;
    auth
      .getSession()
      .then(({ data }) => {
        if (active) setState({ session: data.session, loading: false });
      })
      // Unreadable storage: start signed out rather than stay on the splash forever.
      .catch(() => {
        if (active) setState({ session: null, loading: false });
      });
    const { data } = auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, loading: false });
    });
    // Refresh tokens only while the app is in the foreground (Supabase's React Native guidance):
    // timers are paused in the background, so refresh at once on return.
    const appState =
      Platform.OS === 'web'
        ? null
        : AppState.addEventListener('change', (next) => {
            if (next === 'active') void auth.startAutoRefresh();
            else void auth.stopAutoRefresh();
          });
    return () => {
      active = false;
      data.subscription.unsubscribe();
      appState?.remove();
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
