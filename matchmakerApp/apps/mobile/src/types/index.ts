import type { AuthMode, SessionState } from '@/services/auth/AuthAdapter';
import type { SwipeAction, User } from '@match-makers/shared';

export type { AuthMode, SessionState };

export interface FeedPage {
  items: User[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  /**
   * Why the deck came back empty, in a sentence, when it did and only then.
   *
   * An empty feed is indistinguishable from an empty match pool unless the app
   * says which of the two it is, and a filter that can empty your deck without
   * explanation is a filter people learn to distrust.
   */
  blockedReason: string | null;
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
