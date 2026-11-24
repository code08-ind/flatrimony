import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authConfigured, config } from './config';
import { fetchWithTimeout } from '@flatrimony/client';
import { storage } from './storage';

/**
 * Supabase client for Auth only (docs/05 §2: clients sign in directly; all writes go through the
 * API). The session is persisted in secure storage and refreshed automatically.
 */
export const supabase: SupabaseClient | null = authConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage,
        storageKey: 'flatrimony.auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      // A timed-out request surfaces as a network error instead of a spinner that never stops.
      global: { fetch: (input, init) => fetchWithTimeout(input, init) },
    })
  : null;
