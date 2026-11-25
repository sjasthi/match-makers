import { setAuthTransport } from '@/services/api/client';
import type { AuthMode } from './AuthAdapter';
import { JWTAuthAdapter } from './JWTAuthAdapter';
import { MockAuthAdapter } from './MockAuthAdapter';

function createAdapter(mode: AuthMode) {
  switch (mode) {
    case 'jwt':
      return new JWTAuthAdapter();
    case 'mock':
      return new MockAuthAdapter();
  }
}

function isAuthMode(value: unknown): value is AuthMode {
  return value === 'mock' || value === 'jwt';
}

function readInitialMode(): AuthMode {
  // The app always uses JWT. Mock mode is selected only by Jest's setup so the
  // existing unit/screen tests can exercise their local test backend.
  if (process.env.NODE_ENV !== 'test') return 'jwt';
  const fromEnv = process.env.EXPO_PUBLIC_AUTH_MODE;
  return isAuthMode(fromEnv) ? fromEnv : 'mock';
}

let activeMode: AuthMode = readInitialMode();
let activeAdapter = createAdapter(activeMode);

export function getAuthAdapter() {
  return activeAdapter;
}

export function getActiveAuthMode(): AuthMode {
  return activeMode;
}

/** Test-only adapter switch. The application UI always uses JWT. */
export async function setActiveAuthMode(mode: AuthMode): Promise<void> {
  if (process.env.NODE_ENV !== 'test' && mode !== 'jwt') {
    throw new Error('The application only supports JWT authentication.');
  }
  if (mode === activeMode) return;
  await activeAdapter.clear();
  activeMode = mode;
  activeAdapter = createAdapter(mode);
  setAuthTransport(activeAdapter);
}

/** Called once on app start. Installs the JWT transport. */
export async function bootstrapAuth(): Promise<void> {
  setAuthTransport(activeAdapter);
}

export type { AuthAdapter, AuthMode, SessionState } from './AuthAdapter';
export { AuthError } from './AuthError';
