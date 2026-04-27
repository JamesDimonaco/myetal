/**
 * Per-install random token used as X-View-Token for view deduplication (D3.1).
 *
 * Generated once per install, persisted in secure storage. Sent with every
 * public share fetch so the backend can deduplicate views per device without
 * requiring sign-in. The format is a 32-char hex string — good enough for
 * dedup without adding a uuid dependency.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'myetal.view_token.v1';

let cached: string | null = null;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  // globalThis.crypto is available in Hermes (RN 0.76+) and browsers
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getViewToken(): Promise<string> {
  if (cached) return cached;

  let token: string | null = null;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      token = window.localStorage.getItem(KEY);
    }
  } else {
    token = await SecureStore.getItemAsync(KEY);
  }

  if (token) {
    cached = token;
    return token;
  }

  token = randomHex(16);
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KEY, token);
    }
  } else {
    await SecureStore.setItemAsync(KEY, token);
  }

  cached = token;
  return token;
}
