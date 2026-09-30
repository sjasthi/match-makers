import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Keychain / Keystore backed store for small secrets (tokens, session ids).
 *
 * NOTE: iOS/Android limit a single value to ~2KB. Never use this for
 * collections of records; use `persistentStore` for those.
 */
export const secureStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
  clear: async () => {
    // expo-secure-store has no "clear all" primitive, so this is a no-op.
    // Callers must remove individual keys.
  },
};

/**
 * Larger, unencrypted store for non-secret collections (mock database,
 * cached feed pages, UI preferences). Works on every platform including web.
 */
export const persistentStore: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
  clear: () => AsyncStorage.clear(),
};

/**
 * Picks the correct secret store for the current platform.
 * `expo-secure-store` has no web implementation, so web falls back to
 * AsyncStorage. Fine for a prototype, but do NOT ship this on web.
 */
export function getSecretStore(): KeyValueStore {
  return Platform.OS === 'web' ? persistentStore : secureStore;
}

export async function readJson<T>(store: KeyValueStore, key: string, fallback: T): Promise<T> {
  const raw = await store.get(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupted entry: drop it and fall back rather than crashing the app.
    await store.remove(key);
    return fallback;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  return store.set(key, JSON.stringify(value));
}
