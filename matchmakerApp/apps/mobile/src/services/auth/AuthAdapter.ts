import type { InternalAxiosRequestConfig } from 'axios';
import type {
  AuthResult,
  Credentials,
  RegisterData,
  User,
  VerificationStatus,
} from '@match-makers/shared';

/**
 * How the app proves who it is.
 * - `mock`    local in-memory backend, no server needed
 * - `jwt`     Authorization header + refresh token rotation
 * - `session` HttpOnly cookie session, requests sent with credentials
 */
export type AuthMode = 'mock' | 'jwt' | 'session';

export const AUTH_MODES: readonly AuthMode[] = ['mock', 'jwt', 'session'];

/**
 * Everything the HTTP layer needs to know about auth. The API client depends
 * only on this, so swapping adapters never requires touching the client.
 */
export interface AuthTransport {
  readonly mode: AuthMode;
  /** Mutates an outgoing request to carry credentials. */
  applyToRequest(config: InternalAxiosRequestConfig): Promise<void>;
  /** Renews credentials after a 401. Throws if the session cannot be recovered. */
  refresh(): Promise<void>;
  /** Drops all local credentials. Must not throw. */
  clear(): Promise<void>;
}

export interface AuthAdapter extends AuthTransport {
  login(credentials: Credentials): Promise<AuthResult>;
  register(data: RegisterData): Promise<AuthResult>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
  updateProfile(updates: Partial<User>): Promise<User>;
  getVerificationStatus(): Promise<VerificationStatus>;
}

export type SessionState = 'unknown' | 'authenticated' | 'anonymous' | 'needs_onboarding';
