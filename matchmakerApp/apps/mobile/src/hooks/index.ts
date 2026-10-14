import { useMemo } from 'react';

import { useAuthStore } from '@/stores/authStore';
import { useFeedStore, useMatchesStore } from '@/stores/feedStore';
import { usePhotoFeedStore } from '@/stores/photoFeedStore';
import type { User } from '@match-makers/shared';
import type { AuthMode, SwipeType } from '@/types';
import { APP_CONFIG } from '@/constants';

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
  const state = useFeedStore((store) => store.state);
  const error = useFeedStore((store) => store.error);
  const hasMore = useFeedStore((store) => store.hasMore);
  const blockedReason = useFeedStore((store) => store.blockedReason);
  const needsTaste = useFeedStore((store) => store.needsTaste);
  const lastMatch = useFeedStore((store) => store.lastMatch);
  const load = useFeedStore((store) => store.load);
  const loadMore = useFeedStore((store) => store.loadMore);
  const swipe = useFeedStore((store) => store.swipe);
  const dismissMatch = useFeedStore((store) => store.dismissMatch);
  return {
    profiles,
    state,
    error,
    hasMore,
    blockedReason,
    needsTaste,
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
    like: (userId: string) => swipe(userId, 'like' as SwipeType),
    pass: (userId: string) => swipe(userId, 'pass' as SwipeType),
    superLike: (userId: string) => swipe(userId, 'super_like' as SwipeType),
  };
}

/**
 * The landing tab's photo feed.
 *
 * Deliberately not gated on the questionnaire the way the deck is. This tab is
 * browsable from the moment somebody signs in, which is the point of splitting
 * it out: the feed is how you tell the app what you like before it has any right
 * to tell you who you would like.
 */
export function usePhotoFeed() {
  const posts = usePhotoFeedStore((store) => store.posts);
  const reactions = usePhotoFeedStore((store) => store.reactions);
  const state = usePhotoFeedStore((store) => store.state);
  const error = usePhotoFeedStore((store) => store.error);
  const total = usePhotoFeedStore((store) => store.total);
  const summary = usePhotoFeedStore((store) => store.summary);
  const activeTag = usePhotoFeedStore((store) => store.activeTag);
  const page = usePhotoFeedStore((store) => store.page);
  const summaryExpanded = usePhotoFeedStore((store) => store.summaryExpanded);
  const load = usePhotoFeedStore((store) => store.load);
  const refresh = usePhotoFeedStore((store) => store.refresh);
  const react = usePhotoFeedStore((store) => store.react);
  const setActiveTag = usePhotoFeedStore((store) => store.setActiveTag);
  const setPage = usePhotoFeedStore((store) => store.setPage);
  const toggleSummaryExpanded = usePhotoFeedStore((store) => store.toggleSummaryExpanded);

  /**
   * What the grid is looking at: the whole library, or one category of it.
   *
   * Filtered here rather than in the grid so both surfaces agree. The grid needs
   * the filtered list to lay out and to count pages; the viewer needs it to find
   * the post it was opened on. Two filters in two places is two answers.
   */
  const visible = useMemo(
    () => (activeTag ? posts.filter((post) => post.tags.includes(activeTag)) : posts),
    [posts, activeTag]
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / APP_CONFIG.FEED_PAGE_SIZE));

  /**
   * Clamped, because the stored page can point past the end of a smaller list.
   *
   * Not only a filter problem: answering no longer changes the length, but
   * deleting photos from the library does, and a page index that survived a
   * reload would otherwise open on an empty grid.
   */
  const currentPage = Math.min(page, pageCount - 1);

  const pagePosts = useMemo(() => {
    const start = currentPage * APP_CONFIG.FEED_PAGE_SIZE;
    return visible.slice(start, start + APP_CONFIG.FEED_PAGE_SIZE);
  }, [visible, currentPage]);

  const answeredCount = useMemo(() => Object.keys(reactions).length, [reactions]);

  return {
    posts,
    visible,
    /** Just this page of the filtered set. */
    pagePosts,
    page: currentPage,
    pageCount,
    reactions,
    state,
    error,
    total,
    summary,
    activeTag,
    summaryExpanded,
    answeredCount,
    /** Photos still waiting on an answer. Zero once the whole library is done. */
    /** Photos still waiting on an answer. Zero once the whole library is done. */
    remaining: Math.max(0, total - answeredCount),
    load,
    refresh,
    react,
    setActiveTag,
    setPage,
    toggleSummaryExpanded,
    /** True when the library itself is empty, rather than this person having answered all of it. */
    libraryIsEmpty: state === 'success' && total === 0,
    /**
     * Every category present in the library, alphabetically.
     *
     * Derived from what is loaded rather than from a vocabulary service, so it
     * only ever offers a filter that has something behind it. Ordering is
     * alphabetical rather than by usage because usage counts would need another
     * service call on a surface that only needs a chip label.
     */
    availableTags: useMemo(
      () => [...new Set(posts.flatMap((post) => post.tags))].sort(),
      [posts]
    ),
  };
}
