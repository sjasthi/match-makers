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
 * - `mock` local in-memory backend, no server needed
 * - `jwt`  Authorization header + refresh token rotation, against `apps/api`
 *
 * `session` (HttpOnly cookie) used to be a third option and has been removed.
 * The API never implemented cookies -- no `Set-Cookie`, no session middleware --
 * so selecting it could only ever produce a login that fails with no
 * explanation. Leaving a mode in the switcher that is 100% broken is worse than
 * not offering it, and the type no longer admits it, so it cannot creep back in
 * at a call site.
 */
export type AuthMode = 'mock' | 'jwt';

export const AUTH_MODES: readonly AuthMode[] = ['mock', 'jwt'];

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
