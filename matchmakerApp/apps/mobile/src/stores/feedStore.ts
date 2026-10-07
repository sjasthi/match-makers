import { create } from 'zustand';
import type { User } from '@match-makers/shared';
import { AuthError } from '@/services/auth/AuthError';
import { fetchFeed, sendSwipe } from '@/services/feed';
import { fetchMatches, type MatchSummary } from '@/services/matches';
import type { LoadState, SwipeOutcome, SwipeType } from '@/types';

const PAGE_SIZE = 10;

interface FeedStore {
  profiles: User[];
  page: number;
  hasMore: boolean;
  state: LoadState;
  error: string | null;
  /**
   * Why an empty deck came back empty, in a sentence, or null when it did not.
   *
   * Held here rather than recomputed on the screen because it arrives with the
   * page: answering it needs every candidate, not the ten in front of you.
   * Cleared on a successful load, so widening a filter visibly clears the
   * complaint that made you widen it.
   */
  blockedReason: string | null;
  /** Most recent match, surfaced as an overlay on the feed. */
  lastMatch: SwipeOutcome | null;
  isSwiping: boolean;
  activeIndex: number;

  load: (options?: { refresh?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  swipe: (action: SwipeType) => Promise<void>;
  dismissMatch: () => void;
  reset: () => void;
}

const INITIAL = {
  profiles: [] as User[],
  page: 1,
  hasMore: true,
  state: 'idle' as LoadState,
  error: null as string | null,
  blockedReason: null as string | null,
  lastMatch: null as SwipeOutcome | null,
  isSwiping: false,
  activeIndex: 0,
};

export const useFeedStore = create<FeedStore>((set, get) => ({
  ...INITIAL,

  load: async ({ refresh = false } = {}) => {
    set({ state: refresh ? 'refreshing' : 'loading', error: null });
    try {
      const result = await fetchFeed(1, PAGE_SIZE);
      set({
        profiles: result.items,
        page: 1,
        hasMore: result.hasMore,
        activeIndex: 0,
        blockedReason: result.blockedReason,
        state: 'success',
      });
    } catch (error) {
      set({ state: 'error', error: AuthError.unknown(error).message });
    }
  },

  loadMore: async () => {
    const { hasMore, page, state } = get();
    if (!hasMore || state === 'loading') return;

    set({ state: 'loading' });
    try {
      const next = page + 1;
      const result = await fetchFeed(next, PAGE_SIZE);
      set((current) => ({
        profiles: [...current.profiles, ...result.items],
        page: next,
        hasMore: result.hasMore,
        state: 'success',
      }));
    } catch {
      set({ state: 'success' });
    }
  },

  swipe: async (action) => {
    const { profiles, activeIndex } = get();
    const target = profiles[activeIndex];
    if (!target) return;

    set({ isSwiping: true });
    try {
      const outcome = await sendSwipe(target.id, action);
      set((current) => ({
        // Advance immediately; the request settles behind the animation.
        profiles: current.profiles.filter((_, index) => index !== current.activeIndex),
        activeIndex: 0,
        lastMatch: outcome.isMatch ? outcome : current.lastMatch,
        isSwiping: false,
      }));

      if (get().hasMore) {
        void get().loadMore();
      }
    } catch (error) {
      set({ isSwiping: false, error: AuthError.unknown(error).message });
      throw error;
    }
  },

  dismissMatch: () => set({ lastMatch: null }),
  reset: () => set(INITIAL),
}));

interface MatchesStore {
  matches: MatchSummary[];
  state: LoadState;
  error: string | null;
  load: (options?: { refresh?: boolean }) => Promise<void>;
  reset: () => void;
}

export const useMatchesStore = create<MatchesStore>((set) => ({
  matches: [],
  state: 'idle',
  error: null,

  load: async ({ refresh = false } = {}) => {
    set({ state: refresh ? 'refreshing' : 'loading', error: null });
    try {
      const matches = await fetchMatches();
      set({ matches, state: 'success' });
    } catch (error) {
      set({ state: 'error', error: AuthError.unknown(error).message });
    }
  },

  reset: () => set({ matches: [], state: 'idle', error: null }),
}));
