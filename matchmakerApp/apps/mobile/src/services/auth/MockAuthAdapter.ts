import type { InternalAxiosRequestConfig } from 'axios';
import type {
  AuthResult,
  AuthTokens,
  Credentials,
  RegisterData,
  User,
  VerificationStatus,
} from '@match-makers/shared';
import { RelationshipGoal, SexualOrientation } from '@match-makers/shared';
import { AUTH_STORAGE_KEYS } from '@/constants';
import { getSecretStore } from '@/services/storage/keyValueStore';
import { mockDb, toPublicUser, type StoredUser } from '@/services/mock/database';
import { simulateLatency, maybeSimulateFailure } from '@/services/mock/network';
import { AuthError } from './AuthError';
import type { AuthAdapter, AuthMode } from './AuthAdapter';

const MOCK_REFRESH_TOKEN = 'mock.refresh.token';

/**
 * Offline adapter used for UI work and demos. It issues fake tokens through
 * the same `applyToRequest` / `refresh` contract as the real adapters, so the
 * API client and every screen behave identically whichever mode is active.
 */
export class MockAuthAdapter implements AuthAdapter {
  readonly mode: AuthMode = 'mock';

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
    await simulateLatency();
    maybeSimulateFailure();

    const user = await mockDb.findUserByEmail(credentials.email);
    if (!user || user.password !== credentials.password) {
      throw new AuthError('Invalid email or password', {
        code: 'UNAUTHORIZED',
        fieldErrors: { email: 'Check your email and password' },
      });
    }

    await this.startSession(user);
    return { user: toPublicUser(user), tokens: this.issueTokens() };
  }

  async register(data: RegisterData): Promise<AuthResult> {
    await simulateLatency();
    maybeSimulateFailure();

    const existing = await mockDb.findUserByEmail(data.email);
    if (existing) {
      throw new AuthError('An account with that email already exists', {
        code: 'CONFLICT',
        fieldErrors: { email: 'Already registered' },
      });
    }

    const now = new Date().toISOString();
    const user: StoredUser = {
      id: `user_${Date.now().toString(36)}`,
      email: data.email.trim().toLowerCase(),
      password: data.password,
      name: data.name,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      sexualOrientation: SexualOrientation.PREFER_NOT_TO_SAY,
      relationshipGoal: RelationshipGoal.NOT_SURE,
      bio: '',
      photos: [],
      location: { latitude: 0, longitude: 0, city: '', country: '' },
      preferences: {
        ageRange: { min: 24, max: 38 },
        // Nearby, not global: a new account has no location yet, and defaulting
        // to global would quietly widen every distance rule the moment somebody
        // registered. `isProfileComplete` keeps the account in onboarding until a
        // real location exists, so this only affects the one screen in between.
        distanceMode: 'nearby',
        maxDistance: 50,
        genders: [],
        relationshipGoals: [],
      },
      // Deliberately no questionnaire: isProfileComplete requires one, so this
      // is what holds a new account in onboarding until every step is answered.
      isVerified: false,
      createdAt: now,
      updatedAt: now,
    };

    await mockDb.saveUser(user);
    await this.startSession(user);
    return { user: toPublicUser(user), tokens: this.issueTokens() };
  }

  async refresh(): Promise<void> {
    await simulateLatency();
    const currentUserId = await this.currentUserId();
    if (!currentUserId) {
      throw new AuthError('Your session has expired. Please sign in again.', {
        code: 'UNAUTHORIZED',
      });
    }
    const tokens = this.issueTokens();
    await this.store.set(AUTH_STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
  }

  async logout(): Promise<void> {
    await simulateLatency();
    await mockDb.setCurrentUserId(null);
    await this.clear();
  }

  async getCurrentUser(): Promise<User | null> {
    const currentUserId = await this.currentUserId();
    if (!currentUserId) return null;
    const user = await mockDb.findUserById(currentUserId);
    return user ? toPublicUser(user) : null;
  }

  async updateProfile(updates: Partial<User>): Promise<User> {
    await simulateLatency();
    maybeSimulateFailure();

    const currentUserId = await this.currentUserId();
    if (!currentUserId) {
      throw new AuthError('You need to be signed in to edit your profile', {
        code: 'UNAUTHORIZED',
      });
    }

    const existing = await mockDb.findUserById(currentUserId);
    if (!existing) {
      throw new AuthError('Profile not found', { code: 'NOT_FOUND' });
    }

    const saved = await mockDb.saveUser({ ...existing, ...updates });
    return toPublicUser(saved);
  }

  async getVerificationStatus(): Promise<VerificationStatus> {
    await simulateLatency();
    const currentUserId = await this.currentUserId();
    if (!currentUserId) {
      throw new AuthError('You need to be signed in to view verification', {
        code: 'UNAUTHORIZED',
      });
    }
    const user = await mockDb.findUserById(currentUserId);
    return user?.isVerified ? { status: 'verified', method: 'selfie' } : { status: 'unverified' };
  }

  async clear(): Promise<void> {
    const store = this.store;
    await Promise.all([
      store.remove(AUTH_STORAGE_KEYS.ACCESS_TOKEN),
      store.remove(AUTH_STORAGE_KEYS.REFRESH_TOKEN),
      store.remove(AUTH_STORAGE_KEYS.SESSION_ID),
      store.remove(MOCK_REFRESH_TOKEN),
    ]);
  }

  private async currentUserId(): Promise<string | null> {
    const state = await mockDb.getState();
    return state.currentUserId;
  }

  private async startSession(user: StoredUser): Promise<void> {
    await mockDb.setCurrentUserId(user.id);
    const tokens = this.issueTokens();
    const store = this.store;
    await Promise.all([
      store.set(AUTH_STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken),
      store.set(AUTH_STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken),
      store.set(MOCK_REFRESH_TOKEN, tokens.refreshToken),
    ]);
  }

  private issueTokens(): AuthTokens {
    const stamp = Date.now().toString(36);
    const noise = Math.random().toString(36).slice(2, 10);
    return {
      accessToken: `mock.${stamp}.${noise}`,
      refreshToken: MOCK_REFRESH_TOKEN,
      expiresIn: 3600,
    };
  }
}
