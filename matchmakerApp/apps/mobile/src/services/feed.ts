import { getApiClient } from '@/services/api/client';
import { getAuthAdapter } from '@/services/auth';
import { mockDb, toPublicUser } from '@/services/mock/database';
import { simulateLatency, maybeSimulateFailure } from '@/services/mock/network';
import { scoreCompatibility, type TasteSignal } from '@/utils/matching';
import {
  buildTasteIndex,
  PHOTOS_FOR_FULL_TASTE,
  tasteBetween,
  type TasteIndex,
} from '@/utils/taste';
import { mutualGate, summariseBlockers, type BlockerCode } from '@/utils/eligibility';
import type { FeedPage, SwipeOutcome, SwipeType } from '@/types';

const DEFAULT_PAGE_SIZE = 10;

/**
 * The photo feed's contribution to the deck, built once per load.
 *
 * Loaded alongside the users rather than lazily per candidate: every candidate
 * needs the same table, and rebuilding an index twenty times over is the kind of
 * thing that is free on a twenty row seed and quadratic on a real one.
 */
async function loadTasteIndex(): Promise<TasteIndex> {
  const [posts, reactions] = await Promise.all([mockDb.allPosts(), mockDb.allPostReactions()]);
  return buildTasteIndex(reactions, posts);
}

/**
 * Builds the deck from mutually eligible profiles with a photo-taste score of
 * at least 80%. A missing or lower score keeps a profile out of Likes.
 *
 * Eligibility and scoring are deliberately separate. `mutualGate` decides
 * who is allowed to appear at all, in both directions, and knows nothing about the score;
 * `scoreCompatibility` ranks the people who survived and knows nothing about
 * distance. Only scored candidates at or above 80% appear in the deck. The API
 * route applies the same threshold.
 *
 * Scoring runs before filtering rather than after, so the breakdown that sorts
 * the deck is the same object the cards render. Computing it for people who get
 * filtered out costs a little work on a twenty row seed and saves a second pass
 * that would have to recompute it anyway.
 */
async function buildMockFeed(page: number, pageSize: number): Promise<FeedPage> {
  const adapter = getAuthAdapter();
  const viewer = await adapter.getCurrentUser();
  if (!viewer) {
    return { items: [], page, pageSize, total: 0, hasMore: false, blockedReason: null, needsTaste: false };
  }

  const [allUsers, swipedIds, taste] = await Promise.all([
    mockDb.allUsers(),
    mockDb.swipedUserIds(viewer.id),
    loadTasteIndex(),
  ]);

  const viewerLikes = taste.likeCountByUser.get(viewer.id) ?? 0;

  const scored = allUsers
    .filter((user) => user.id !== viewer.id)
    .map((user) => ({
      user,
      breakdown: scoreCompatibility(viewer, toPublicUser(user), tasteSignal(taste, viewer.id, user.id)),
    }));

  const blocked: BlockerCode[] = [];
  const eligible = scored.filter(({ user }) => {
    if (swipedIds.has(user.id)) {
      blocked.push('already_swiped');
      return false;
    }

    // Both directions, tracked separately, through the one shared definition.
    // Your own requirements and the fact that someone filtered you out are
    // different problems with different fixes, and the empty state has to name
    // the right one — which is why `mutualGate` keeps them apart rather than
    // merging them into a single list.
    const gate = mutualGate(viewer, user);
    if (!gate.eligible) {
      // A pair can fail both ways. Naming your own filters is only true when your
      // filters are the reason, so the other side is reported as theirs.
      if (gate.blockedByYou.length > 0) blocked.push(...gate.blockedByYou);
      else blocked.push('their_requirements');
      return false;
    }

    return true;
  });

  eligible.sort((a, b) => {
    // Null scores (no photo evidence) sort last
    if (a.breakdown.score === null && b.breakdown.score === null) return 0;
    if (a.breakdown.score === null) return 1;
    if (b.breakdown.score === null) return -1;
    return b.breakdown.score - a.breakdown.score;
  });

  const visibleMatches = eligible.filter(
    ({ breakdown }) => breakdown.score !== null && breakdown.score >= 80
  );

  const start = (page - 1) * pageSize;
  const items = visibleMatches
    .slice(start, start + pageSize)
    .map(({ user, breakdown }) => ({ user: toPublicUser(user), compatibility: breakdown }));

  return {
    items,
    page,
    pageSize,
    total: visibleMatches.length,
    hasMore: start + pageSize < visibleMatches.length,
    blockedReason:
      visibleMatches.length === 0
        ? eligible.length > 0
          ? 'No strong matches yet — like more photos to find them.'
          : summariseBlockers(blocked)
        : null,
    needsTaste: viewerLikes < PHOTOS_FOR_FULL_TASTE,
  };
}

/**
 * Adapts the feed's taste signal to the shape the scorer takes.
 *
 * `tasteBetween` returns the same fields under different names, so this is the
 * one place the two vocabularies meet. Done as a function rather than inlined so
 * the feed does not depend on the matcher's type layout.
 */
function tasteSignal(index: TasteIndex, viewerId: string, candidateId: string): TasteSignal {
  const { affinity, coLikedPosts, sharedTags, reason } = tasteBetween(index, viewerId, candidateId);
  return { affinity, coLikedPosts, sharedTags, reason };
}

export async function fetchFeed(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<FeedPage> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();
    return buildMockFeed(page, pageSize);
  }

  // The server holds the caller's preferences and applies the same mutual
  // rules, so the client sends paging only. It owns `blockedReason` as well:
  // naming the reason a deck is empty is a query against every candidate, and
  // the server can answer it better than the client can from one page.
  const response = await getApiClient().get<FeedPage>('/feed', { params: { page, pageSize } });
  return { ...response.data, blockedReason: response.data.blockedReason ?? null };
}

/**
 * Records a swipe. Returns whether it produced a match so the UI can decide
 * whether to show the match celebration overlay.
 */
export async function sendSwipe(targetUserId: string, action: SwipeType): Promise<SwipeOutcome> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();

    const adapter = getAuthAdapter();
    const viewer = await adapter.getCurrentUser();
    if (!viewer) throw new Error('You need to be signed in to swipe');

    const swipe = await mockDb.recordSwipe(viewer.id, targetUserId, action);
    const target = await mockDb.findUserById(targetUserId);
    if (!target) throw new Error('That profile is no longer available');

    // Reciprocity is faked with a fixed probability, which keeps the demo
    // predictable enough to show both the match and the no-match paths.
    const isMatch = action === 'like' && Math.random() < 0.35;
    if (!isMatch) {
      return { swipeId: swipe.id, isMatch: false };
    }

    const match = await mockDb.createMatch([viewer.id, target.id]);
    return {
      swipeId: swipe.id,
      isMatch: true,
      matchId: match.id,
      matchedUser: toPublicUser(target),
    };
  }

  const response = await getApiClient().post<{
    swipeId: string;
    isMatch: boolean;
    match?: { id: string };
  }>('/swipes', { targetUserId, action });
  return {
    swipeId: response.data.swipeId,
    isMatch: response.data.isMatch,
    matchId: response.data.match?.id,
  };
}
