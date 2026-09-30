import type { InternalAxiosRequestConfig } from 'axios';
import type {
  AuthResult,
  AuthTokens,
  Credentials,
  RegisterData,
  User,
  VerificationStatus,
} from '@match-makers/shared';
import { AUTH_STORAGE_KEYS } from '@/constants';
import { getSecretStore } from '@/services/storage/keyValueStore';
import { getApiClient } from '@/services/api/client';
import { AuthError } from './AuthError';
import type { AuthAdapter, AuthMode } from './AuthAdapter';

/**
 * Talks to the FP2 backend using short-lived bearer tokens.
 *
 * Refresh token rotation is handled centrally by the API client's response
 * interceptor, so `refresh()` here only needs to perform one round trip.
 */
export class JWTAuthAdapter implements AuthAdapter {
  readonly mode: AuthMode = 'jwt';

  private get store() {
    return getSecretStore();
  }

  async applyToRequest(config: InternalAxiosRequestConfig): Promise<void> {
    const accessToken = await this.store.get(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
  }

  async login(credentials: Credentials): Promise<AuthResult> {
    try {
      const response = await getApiClient().post<AuthResult>('/auth/login', credentials);
      const tokens = response.data.tokens;
      if (tokens) await this.storeTokens(tokens);
      return response.data;
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async register(data: RegisterData): Promise<AuthResult> {
    try {
      const response = await getApiClient().post<AuthResult>('/auth/register', data);
      const tokens = response.data.tokens;
      if (tokens) await this.storeTokens(tokens);
      return response.data;
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async refresh(): Promise<void> {
    const refreshToken = await this.store.get(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) {
      throw new AuthError('Your session has expired. Please sign in again.', {
        code: 'UNAUTHORIZED',
      });
    }
    const response = await getApiClient().post<{ tokens: AuthTokens }>('/auth/refresh', {
      refreshToken,
    });
    await this.storeTokens(response.data.tokens);
  }

  async logout(): Promise<void> {
    try {
      await getApiClient().post('/auth/logout');
    } catch {
      // A failed logout call must never block the local sign-out.
    } finally {
      await this.clear();
    }
  }

  async getCurrentUser(): Promise<User | null> {
    try {
      const response = await getApiClient().get<User>('/auth/me');
      return response.data;
    } catch (error) {
      if (error instanceof AuthError && error.code === 'UNAUTHORIZED') return null;
      throw error;
    }
  }

  async updateProfile(updates: Partial<User>): Promise<User> {
    try {
      const response = await getApiClient().patch<User>('/profile', updates);
      return response.data;
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async getVerificationStatus(): Promise<VerificationStatus> {
    try {
      const response = await getApiClient().get<VerificationStatus>('/profile/verification');
      return response.data;
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async clear(): Promise<void> {
    const store = this.store;
    await Promise.all([
      store.remove(AUTH_STORAGE_KEYS.ACCESS_TOKEN),
      store.remove(AUTH_STORAGE_KEYS.REFRESH_TOKEN),
    ]);
  }

  private async storeTokens(tokens: AuthTokens): Promise<void> {
    const store = this.store;
    await Promise.all([
      store.set(AUTH_STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken),
      store.set(AUTH_STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken),
    ]);
  }
}

export function toAuthError(error: unknown): AuthError {
  return error instanceof AuthError ? error : AuthError.unknown(error);
}
