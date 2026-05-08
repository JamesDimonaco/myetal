/**
 * Secure storage of the Better Auth session JWT (Phase 4 cutover).
 *
 * Better Auth's JWT plugin issues a short-lived (15 min) Ed25519-signed
 * access token. Mobile uses Bearer auth — the cookie BA also sets is
 * irrelevant outside the browser. There is no refresh token: when the JWT
 * expires the user re-signs-in (cheaper than juggling a second secret on
 * the device, and matches the locked decision in the migration ticket).
 *
 * - Native (iOS/Android): expo-secure-store delegates to Keychain / Keystore so
 *   the token survives app restarts but never leaks via backups or shared
 *   storage.
 * - Web: expo-secure-store has no web implementation, so we fall back to
 *   `localStorage` (only meaningful for `expo start --web` during dev — the
 *   real public web UI lives in apps/web with httpOnly cookies).
 *
 * Storage key bumped to `myetal.session.v2` so any leftover legacy
 * access/refresh-token blob from before the cutover is silently ignored
 * — testers re-sign-up after the migration anyway.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const STORAGE_KEY = 'myetal.session.v2';

export interface StoredSession {
  /** Better Auth Ed25519-signed access JWT. */
  token: string;
  /** Cached id of the signed-in user — drives optimistic UI before /me lands. */
  userId?: string;
  /** Cached email of the signed-in user — same purpose. */
  email?: string;
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

export async function getSession(): Promise<StoredSession | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || parsed.token.length === 0) {
      return null;
    }
    return {
      token: parsed.token,
      userId: typeof parsed.userId === 'string' ? parsed.userId : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
    };
  } catch {
    return null;
  }
}

export async function setSession(session: StoredSession): Promise<void> {
  await storage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await storage.removeItem(STORAGE_KEY);
}

/** Read just the token — convenience for the api client. */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  return session?.token ?? null;
}
