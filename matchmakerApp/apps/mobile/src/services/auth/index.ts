import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_STORAGE_KEYS } from '@/constants';
import { setAuthTransport } from '@/services/api/client';
import type { AuthMode } from './AuthAdapter';
import { JWTAuthAdapter } from './JWTAuthAdapter';
import { MockAuthAdapter } from './MockAuthAdapter';
import { SessionAuthAdapter } from './SessionAuthAdapter';

function createAdapter(mode: AuthMode) {
  switch (mode) {
    case 'jwt':
      return new JWTAuthAdapter();
    case 'session':
      return new SessionAuthAdapter();
    case 'mock':
      return new MockAuthAdapter();
  }
}

function isAuthMode(value: unknown): value is AuthMode {
  return value === 'mock' || value === 'jwt' || value === 'session';
}

function readEnvMode(): AuthMode {
  const fromEnv = process.env.EXPO_PUBLIC_AUTH_MODE;
  return isAuthMode(fromEnv) ? fromEnv : 'mock';
}

let activeMode: AuthMode = readEnvMode();
let activeAdapter = createAdapter(activeMode);
let storageHydrated = false;

export function getAuthAdapter() {
  return activeAdapter;
}

export function getActiveAuthMode(): AuthMode {
  return activeMode;
}

/** Switches auth strategy at runtime and re-points the API client at it. */
export async function setActiveAuthMode(mode: AuthMode): Promise<void> {
  if (mode === activeMode) return;
  await activeAdapter.clear();
  activeMode = mode;
  activeAdapter = createAdapter(mode);
  setAuthTransport(activeAdapter);
  await AsyncStorage.setItem(AUTH_STORAGE_KEYS.AUTH_MODE, mode);
}

async function hydratePersistedMode(): Promise<void> {
  if (storageHydrated) return;
  storageHydrated = true;
  const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEYS.AUTH_MODE);
  if (isAuthMode(stored) && stored !== activeMode) {
    activeMode = stored;
    activeAdapter = createAdapter(stored);
  }
  setAuthTransport(activeAdapter);
}

/** Called once on app start. Restores the mode the developer last selected. */
export async function bootstrapAuth(): Promise<void> {
  await hydratePersistedMode();
}

export type { AuthAdapter, AuthMode, SessionState } from './AuthAdapter';
export { AuthError } from './AuthError';
