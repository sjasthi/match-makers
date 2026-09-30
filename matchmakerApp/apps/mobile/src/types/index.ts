import type { AuthMode, SessionState } from '@/services/auth/AuthAdapter';
import type { SwipeAction, User } from '@match-makers/shared';

export type { AuthMode, SessionState };

export interface FeedPage {
  items: User[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface FeedFilters {
  ageRange: { min: number; max: number };
  maxDistance: number;
  genders: string[];
}

export type SwipeType = SwipeAction['type'];

export interface SwipeOutcome {
  swipeId: string;
  isMatch: boolean;
  matchId?: string;
  matchedUser?: User;
}

export type LoadState = 'idle' | 'loading' | 'refreshing' | 'error' | 'success';

export interface Loadable<T> {
  state: LoadState;
  data: T | null;
  error: string | null;
}

export const INITIAL_LOADABLE = {
  state: 'idle',
  data: null,
  error: null,
} as const;
