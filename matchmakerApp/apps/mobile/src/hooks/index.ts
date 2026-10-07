import { useAuthStore } from '@/stores/authStore';
import { useFeedStore, useMatchesStore } from '@/stores/feedStore';
import type { User } from '@match-makers/shared';
import type { AuthMode, SwipeType } from '@/types';

export function useSession() {
  const state = useAuthStore((store) => store.state);
  const user = useAuthStore((store) => store.user);
  const authMode = useAuthStore((store) => store.authMode);
  return { state, user, authMode };
}

export function useCurrentUser(): User | null {
  return useAuthStore((store) => store.user);
}

export function useAuthActions() {
  const login = useAuthStore((store) => store.login);
  const register = useAuthStore((store) => store.register);
  const logout = useAuthStore((store) => store.logout);
  const changeAuthMode = useAuthStore((store) => store.changeAuthMode);
  const refreshUser = useAuthStore((store) => store.refreshUser);
  return { login, register, logout, changeAuthMode, refreshUser };
}

export function useAuthFormState() {
  const isSubmitting = useAuthStore((store) => store.isSubmitting);
  const error = useAuthStore((store) => store.error);
  const fieldErrors = useAuthStore((store) => store.fieldErrors);
  const clearError = useAuthStore((store) => store.clearError);
  return { isSubmitting, error, fieldErrors, clearError };
}

export function useAuthMode(): [AuthMode, (mode: AuthMode) => Promise<void>] {
  const authMode = useAuthStore((store) => store.authMode);
  const changeAuthMode = useAuthStore((store) => store.changeAuthMode);
  return [authMode, changeAuthMode];
}

export function useFeed() {
  const profiles = useFeedStore((store) => store.profiles);
  const current = profiles[0] ?? null;
  const state = useFeedStore((store) => store.state);
  const error = useFeedStore((store) => store.error);
  const hasMore = useFeedStore((store) => store.hasMore);
  const blockedReason = useFeedStore((store) => store.blockedReason);
  const lastMatch = useFeedStore((store) => store.lastMatch);
  const load = useFeedStore((store) => store.load);
  const loadMore = useFeedStore((store) => store.loadMore);
  const swipe = useFeedStore((store) => store.swipe);
  const dismissMatch = useFeedStore((store) => store.dismissMatch);
  return {
    profiles,
    current,
    state,
    error,
    hasMore,
    blockedReason,
    lastMatch,
    load,
    loadMore,
    swipe,
    dismissMatch,
  };
}

export function useMatches() {
  const matches = useMatchesStore((store) => store.matches);
  const state = useMatchesStore((store) => store.state);
  const error = useMatchesStore((store) => store.error);
  const load = useMatchesStore((store) => store.load);
  return { matches, state, error, load };
}

export function useSwipe() {
  const swipe = useFeedStore((store) => store.swipe);
  return {
    like: () => swipe('like' as SwipeType),
    pass: () => swipe('pass' as SwipeType),
    superLike: () => swipe('super_like' as SwipeType),
  };
}
