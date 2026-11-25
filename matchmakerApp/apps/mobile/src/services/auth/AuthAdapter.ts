import type { InternalAxiosRequestConfig } from 'axios';
import type {
  AuthResult,
  Credentials,
  RegisterData,
  User,
  VerificationStatus,
} from '@match-makers/shared';

/**
 * JWT is the only application auth mode. `mock` remains as a Jest-only adapter
 * for the existing screen/service tests.
 */
export type AuthMode = 'mock' | 'jwt';

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
  submitVerification(
    imageData: string,
    imageMime: string
  ): Promise<{ status: VerificationStatus['status']; submittedAt?: string }>;
}

export type SessionState = 'unknown' | 'authenticated' | 'anonymous' | 'needs_onboarding';
