/**
 * Secure storage of the rotating access/refresh JWT pair.
 *
 * - Native (iOS/Android): expo-secure-store delegates to Keychain / Keystore so
 *   tokens survive app restarts but never leak via backups or shared storage.
 * - Web: expo-secure-store has no web implementation, so we fall back to
 *   `localStorage` (only meaningful for `expo start --web` during dev — the
 *   real public web UI lives in apps/web with httpOnly cookies).
 *
 * Storage key is namespaced `myetal.auth.v1` so we can roll formats later
 * without colliding with old installs.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const STORAGE_KEY = 'myetal.auth.v1';

export interface StoredTokens {
  access: string;
  refresh: string;
}

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const webStorage: Storage = {
  async getItem(key) {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  async setItem(key, value) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  async removeItem(key) {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};

const nativeStorage: Storage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

const storage: Storage = Platform.OS === 'web' ? webStorage : nativeStorage;

export async function getTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (typeof parsed.access !== 'string' || typeof parsed.refresh !== 'string') {
      return null;
    }
    return { access: parsed.access, refresh: parsed.refresh };
  } catch {
    return null;
  }
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  const value = JSON.stringify({ access, refresh } satisfies StoredTokens);
  await storage.setItem(STORAGE_KEY, value);
}

export async function clearTokens(): Promise<void> {
  await storage.removeItem(STORAGE_KEY);
}
