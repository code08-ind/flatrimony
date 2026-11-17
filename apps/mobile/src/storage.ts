/**
 * Small key-value storage. On Android: expo-secure-store (Keystore-backed) for the session and
 * install id. On web (the local design-preview target only): localStorage, which is NOT secure;
 * the product web app is apps/web, which keeps tokens in HttpOnly cookies (docs/05 §2).
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const web: KeyValueStore = {
  async getItem(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItem(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
  async removeItem(key) {
    globalThis.localStorage?.removeItem(key);
  },
};

const secure: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const storage: KeyValueStore = Platform.OS === 'web' ? web : secure;
