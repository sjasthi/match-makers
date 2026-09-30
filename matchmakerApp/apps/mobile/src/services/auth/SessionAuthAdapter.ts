import type { InternalAxiosRequestConfig } from 'axios';
import type {
  AuthResult,
  Credentials,
  RegisterData,
  User,
  VerificationStatus,
} from '@match-makers/shared';
import { AUTH_STORAGE_KEYS } from '@/constants';
import { getSecretStore } from '@/services/storage/keyValueStore';
import { getApiClient } from '@/services/api/client';
import { AuthError } from './AuthError';
import { toAuthError } from './JWTAuthAdapter';
import type { AuthAdapter, AuthMode } from './AuthAdapter';

/**
 * Talks to the FP2 backend using a server-side session in an HttpOnly cookie.
 *
 * The cookie is unreadable from JavaScript by design, so the only thing this
 * adapter does is ask the browser/native networking layer to send it along.
 * On web that additionally requires the API to send CORS credentials.
 */
export class SessionAuthAdapter implements AuthAdapter {
  readonly mode: AuthMode = 'session';

  private get store() {
    return getSecretStore();
  }

  async applyToRequest(config: InternalAxiosRequestConfig): Promise<void> {
    config.withCredentials = true;
    // The session id is not a credential, but some deployments echo it back
    // in a header for CSRF correlation.
    const sessionId = await this.store.get(AUTH_STORAGE_KEYS.SESSION_ID);
    if (sessionId) {
      config.headers['X-Session-Id'] = sessionId;
    }
  }

  async login(credentials: Credentials): Promise<AuthResult> {
    try {
      const response = await getApiClient().post<AuthResult>('/auth/login', credentials, {
        withCredentials: true,
      });
      await this.rememberSessionId(response.data.sessionId);
      return response.data;
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async register(data: RegisterData): Promise<AuthResult> {
    try {
      const response = await getApiClient().post<AuthResult>('/auth/register', data, {
        withCredentials: true,
      });
      await this.rememberSessionId(response.data.sessionId);
      return response.data;
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async refresh(): Promise<void> {
    try {
      const response = await getApiClient().post('/auth/refresh', {}, { withCredentials: true });
      await this.rememberSessionId(
        (response.data as { sessionId?: string } | undefined)?.sessionId
      );
    } catch (error) {
      throw new AuthError('Your session has expired. Please sign in again.', {
        code: 'UNAUTHORIZED',
      });
    }
  }

  async logout(): Promise<void> {
    try {
      await getApiClient().post('/auth/logout', {}, { withCredentials: true });
    } catch {
      // Local sign-out must succeed even if the server call fails.
    } finally {
      await this.clear();
    }
  }

  async getCurrentUser(): Promise<User | null> {
    try {
      const response = await getApiClient().get<User>('/auth/me', { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof AuthError && error.code === 'UNAUTHORIZED') return null;
      throw error;
    }
  }

  async updateProfile(updates: Partial<User>): Promise<User> {
    try {
      const response = await getApiClient().patch<User>('/profile', updates, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async getVerificationStatus(): Promise<VerificationStatus> {
    try {
      const response = await getApiClient().get<VerificationStatus>('/profile/verification', {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async clear(): Promise<void> {
    await this.store.remove(AUTH_STORAGE_KEYS.SESSION_ID);
  }

  private async rememberSessionId(sessionId: string | undefined): Promise<void> {
    if (sessionId) {
      await this.store.set(AUTH_STORAGE_KEYS.SESSION_ID, sessionId);
    }
  }
}
