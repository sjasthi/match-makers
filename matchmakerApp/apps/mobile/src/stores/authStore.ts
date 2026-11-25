import { create } from 'zustand';
import type { Credentials, RegisterData, User } from '@match-makers/shared';
import { AuthError } from '@/services/auth/AuthError';
import { bootstrapAuth, getAuthAdapter } from '@/services/auth';
import { onSessionExpired } from '@/services/api/client';
import { isProfileComplete } from '@/services/profile';
import type { SessionState } from '@/types';

interface AuthStore {
  state: SessionState;
  user: User | null;
  error: string | null;
  fieldErrors: Record<string, string> | undefined;
  isSubmitting: boolean;
  bootstrap: () => Promise<void>;
  login: (credentials: Credentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
  clearError: () => void;
}

function resolveState(user: User | null): SessionState {
  if (!user) return 'anonymous';
  return isProfileComplete(user) ? 'authenticated' : 'needs_onboarding';
}

export const useAuthStore = create<AuthStore>((set) => ({
  state: 'unknown',
  user: null,
  error: null,
  fieldErrors: undefined,
  isSubmitting: false,

  bootstrap: async () => {
    try {
      await bootstrapAuth();
      onSessionExpired(() => {
        set({
          user: null,
          state: 'anonymous',
          error: 'Your session expired. Please sign in again.',
        });
      });
      const adapter = getAuthAdapter();
      const user = await adapter.getCurrentUser().catch(() => null);
      set({ user, state: resolveState(user) });
    } catch (error) {
      // Must never strand the app on the splash screen. Fall through to signed-out.
      set({ user: null, state: 'anonymous', error: AuthError.unknown(error).message });
    }
  },

  login: async (credentials) => {
    set({ isSubmitting: true, error: null, fieldErrors: undefined });
    try {
      const result = await getAuthAdapter().login(credentials);
      set({ user: result.user, state: resolveState(result.user), error: null });
    } catch (error) {
      const authError = AuthError.unknown(error);
      set({ error: authError.message, fieldErrors: authError.fieldErrors });
      throw authError;
    } finally {
      set({ isSubmitting: false });
    }
  },

  register: async (data) => {
    set({ isSubmitting: true, error: null, fieldErrors: undefined });
    try {
      const result = await getAuthAdapter().register(data);
      // A brand new account always goes through onboarding first.
      set({ user: result.user, state: 'needs_onboarding', error: null });
    } catch (error) {
      const authError = AuthError.unknown(error);
      set({ error: authError.message, fieldErrors: authError.fieldErrors });
      throw authError;
    } finally {
      set({ isSubmitting: false });
    }
  },

  logout: async () => {
    await getAuthAdapter().logout();
    set({ user: null, state: 'anonymous', error: null, fieldErrors: undefined });
  },

  refreshUser: async () => {
    const user = await getAuthAdapter()
      .getCurrentUser()
      .catch(() => null);
    if (!user) {
      set({ user: null, state: 'anonymous' });
      return;
    }
    set({ user, state: resolveState(user) });
  },

  setUser: (user) => set({ user, state: resolveState(user) }),

  clearError: () => set({ error: null, fieldErrors: undefined }),
}));
