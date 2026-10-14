import { create } from 'zustand';
import type { Post, PostReactionAction } from '@match-makers/shared';
import type { PhotoFeedPage, TasteSummary } from '@match-makers/shared';

import { AuthError } from '@/services/auth/AuthError';
import { fetchPhotoFeed, fetchTasteSummary, reactToPost, undoPostReaction } from '@/services/posts';
import { adjustOpinionsForReaction } from '@/utils/taste';
import type { LoadState } from '@/types';

const EMPTY_SUMMARY: TasteSummary = { likes: 0, dislikes: 0, tags: [], closest: [] };

/**
 * How long to wait after the last reaction before re-reading the summary.
 *
 * The viewer answers photo after photo, so doing a full recompute per tap meant
 * one rebuild of the taste index over the whole reactions table and one re-score
 * of every candidate, twenty times in a row. Coalescing makes a burst cost one
 * recompute.
 *
 * Not a `useEffect` timer: it is held at module scope so a refresh survives the
 * viewer unmounting mid-wait, which is exactly what happens when the last photo
 * in a page is answered.
 */
export const SUMMARY_SETTLE_MS = 800;

let settleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Bumped by `reset`, so a refresh queued for the session that just ended cannot
 * write its answer into the next one.
 *
 * Cancelling the timer is not enough on its own: a reaction whose write is still
 * in flight calls `scheduleSummaryRefresh` *after* the reset has already run, and
 * queues a fresh timer that then resolves against the new session's data.
 */
let generation = 0;

/** Cancelled in tests so a pending refresh cannot land after the suite moves on. */
export function cancelPendingSummaryRefresh(): void {
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}

/* Reaction writes in flight, so a test can wait for the truth rather than guess. */
let inFlight = 0;
const idleWaiters: Array<() => void> = [];

function beginWrite(): void {
  inFlight += 1;
}

function endWrite(): void {
  inFlight -= 1;
  if (inFlight === 0) {
    for (const resolve of idleWaiters.splice(0)) resolve();
  }
}

/**
 * Resolves once every in-flight reaction write has settled.
 *
 * The screen deliberately calls `react` without awaiting it, which is right for
 * the UI and unhelpful for a test that then resets the database. Counting the
 * writes is the fix; guessing at macrotask counts is not.
 */
export function whenPhotoFeedIdle(): Promise<void> {
  if (inFlight === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

/** Zustand's setter, narrowed to what these helpers actually need. */
type FeedSetter = (partial: Partial<PhotoFeedStore>) => void;

interface PhotoFeedStore {
  /** The whole library, answered or not. Never shrinks. */
  posts: Post[];
  /**
   * This person's answer per post id. A missing key means unanswered.
   *
   * Separate from `posts` rather than encoded by absence, because an answered
   * photo stays in the grid and something has to say it was answered and which
   * way. That is also what makes unlike possible.
   */
  reactions: Record<string, PostReactionAction>;
  state: LoadState;
  error: string | null;
  /** Size of the whole library, so "empty" and "all answered" stay distinct. */
  total: number;
  /**
   * What the feed has worked out about this person's taste.
   *
   * Bumped immediately on every answer, then replaced wholesale by one coalesced
   * refetch once the taps stop. Its `closest` list lags by design, because it
   * depends on everybody else's reactions and cannot be computed from one tap.
   */
  summary: TasteSummary;
  /** Primary tag to filter the grid by, or null for the whole library. */
  activeTag: string | null;
  /** Zero-based page within the filtered set. */
  page: number;
  summaryExpanded: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * Loads the summary only, and only if it is missing.
   *
   * The Likes tab needs to know how many photos this person has answered so it
   * can say whether the score is provisional, but pulling the entire photo page
   * to learn a count would be the wrong order of expense. Safe to call from more
   * than one screen: whoever gets there first does the work.
   */
  ensureSummary: () => Promise<void>;
  /** Toggle: the same action again takes the answer back. */
  react: (postId: string, action: PostReactionAction) => Promise<void>;
  setActiveTag: (tag: string | null) => void;
  setPage: (page: number) => void;
  toggleSummaryExpanded: () => void;
  reset: () => void;
}

const INITIAL = {
  posts: [] as Post[],
  reactions: {} as Record<string, PostReactionAction>,
  state: 'idle' as LoadState,
  error: null as string | null,
  total: 0,
  summary: EMPTY_SUMMARY,
  activeTag: null as string | null,
  page: 0,
  // Open by default. The whole argument for this feature is that it should be
  // visible rather than something the user has to take on faith, so hiding it
  // behind a tap is the wrong default even though it costs grid height.
  summaryExpanded: true,
};

/**
 * What one tap does to the panel.
 *
 * Undo counts the other way, and drops any tag that falls back to zero, so the
 * optimistic value matches what the refetched one will say.
 *
 * `closest` is deliberately untouched. It depends on every other person's
 * reactions and on the whole index, so there is nothing local to bump. It stays
 * as it was until the coalesced refetch lands, which is the honest version: the
 * tallies are ours, that list is not.
 */
function bumpSummary(
  summary: TasteSummary,
  tags: readonly string[],
  action: PostReactionAction,
  undo: boolean
): TasteSummary {
  const step = undo ? -1 : 1;
  return {
    ...summary,
    likes: Math.max(0, summary.likes + (action === 'like' ? step : 0)),
    dislikes: Math.max(0, summary.dislikes + (action === 'dislike' ? step : 0)),
    tags: adjustOpinionsForReaction(summary.tags, tags, action, undo),
  };
}

export const usePhotoFeedStore = create<PhotoFeedStore>((set, get) => ({
  ...INITIAL,

  load: () => runLoad(set, 'loading'),
  refresh: () => runLoad(set, 'refreshing'),

  ensureSummary: async () => {
    // Only while nothing is known. `state` is deliberately not checked: a
    // refresh that failed must not turn into a retry storm from a second screen.
    if (get().summary !== EMPTY_SUMMARY) return;
    try {
      set({ summary: await fetchTasteSummary() });
    } catch {
      // Leaving the strip on its "answer some photos" wording is a better
      // outcome than an error banner on a screen about being introduced to.
    }
  },

  react: async (postId, action) => {
    const target = get().posts.find((post) => post.id === postId);
    if (!target) return;
    beginWrite();

    const before = get().reactions[postId];
    const summaryBefore = get().summary;
    // Pressing the button that is already lit takes the answer back. That is the
    // whole unlike interaction: one control, and the control you pressed to make
    // the answer is the control that removes it.
    const undo = before === action;

    // Answer optimistically. A tap on a photo is the cheapest interaction in the
    // app and there is no animation to hide a round trip behind, so waiting for
    // the write would make the grid feel broken. The photo itself stays put either
    // way — unlike is the point.
    set((current) => {
      const reactions = { ...current.reactions };
      if (undo) delete reactions[postId];
      else reactions[postId] = action;
      return { reactions, summary: bumpSummary(current.summary, target.tags, action, undo), error: null };
    });

    try {
      if (undo) await undoPostReaction(postId);
      else await reactToPost(postId, action);
    } catch (error) {
      // Undo the bump as well as the state: the person is looking at a photo they
      // have already judged, and a panel claiming a like that was rolled back
      // would disagree with the tile two inches above it.
      set((current) => {
        const reactions = { ...current.reactions };
        if (before === undefined) delete reactions[postId];
        else reactions[postId] = before;
        return { reactions, summary: summaryBefore, error: AuthError.unknown(error).message };
      });
      endWrite();
      return;
    }

    endWrite();
    scheduleSummaryRefresh(set);
  },

  setActiveTag: (tag) => {
    // Back to the first page whenever the set changes, because a tag with three
    // photos does not have a page two and leaving you on one shows an empty grid
    // with no explanation.
    set({ activeTag: tag, page: 0 });
  },

  setPage: (page) => set({ page: Math.max(0, page) }),

  toggleSummaryExpanded: () =>
    set((current) => ({ summaryExpanded: !current.summaryExpanded })),

  reset: () => {
    cancelPendingSummaryRefresh();
    generation += 1;
    set(INITIAL);
  },
}));

async function runLoad(set: FeedSetter, state: LoadState): Promise<void> {
  set({ state, error: null });
  try {
    const page: PhotoFeedPage = await fetchPhotoFeed();
    set({
      posts: page.posts,
      reactions: page.reactions,
      total: page.total,
      summary: page.summary,
      state: 'success',
      activeTag: null,
      page: 0,
    });
  } catch (error) {
    set({ state: 'error', error: AuthError.unknown(error).message });
  }
}

/**
 * Re-reads the authoritative summary once the taps stop.
 *
 * Every pending call collapses into one. The bumps already applied on the way in
 * are simply replaced by the server's answer, so there is nothing to reconcile.
 */
function scheduleSummaryRefresh(set: FeedSetter): void {
  cancelPendingSummaryRefresh();
  const mine = generation;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    // The store was reset while this was queued, so whatever comes back belongs
    // to a session that no longer exists.
    if (mine !== generation) return;
    void fetchTasteSummary()
      .then((summary) => set({ summary }))
      .catch(() => {
        // The reaction landed. A stale "who it moved" list is a much smaller
        // problem than making it look like the taps failed.
      });
  }, SUMMARY_SETTLE_MS);
}