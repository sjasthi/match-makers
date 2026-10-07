import { getApiClient } from '@/services/api/client';
import { getAuthAdapter } from '@/services/auth';
import { mockDb, toPublicUser } from '@/services/mock/database';
import { simulateLatency, maybeSimulateFailure } from '@/services/mock/network';
import { scoreCompatibility } from '@/utils/matching';
import { checkEligibility, summariseBlockers, type BlockerCode } from '@/utils/eligibility';
import type { FeedPage, SwipeOutcome, SwipeType } from '@/types';

const DEFAULT_PAGE_SIZE = 10;

/**
 * Builds the deck: everyone whose requirements the two of you both satisfy,
 * best compatibility first.
 *
 * Eligibility and scoring are deliberately separate. `checkEligibility` decides
 * who is allowed to appear at all, in both directions, and knows nothing about the score;
 * `scoreCompatibility` ranks the people who survived and knows nothing about
 * distance. Collapsing them would mean either a good score could pull someone
 * back into a deck their stated requirements exclude them from, or a distance
 * limit could flatten the ordering of everyone inside it, and both of those were
 * explicitly not what the weights are for.
 *
 * Scoring runs before filtering rather than after, so the breakdown that sorts
 * the deck is the same object the cards render. Computing it for people who get
 * filtered out costs a little work on a twenty row seed and saves a second pass
 * that would have to recompute it anyway.
 */
async function buildMockFeed(page: number, pageSize: number): Promise<FeedPage> {
  const adapter = getAuthAdapter();
  const viewer = await adapter.getCurrentUser();
  if (!viewer) return { items: [], page, pageSize, total: 0, hasMore: false, blockedReason: null };

  const [allUsers, swipedIds] = await Promise.all([
    mockDb.allUsers(),
    mockDb.swipedUserIds(viewer.id),
  ]);

  const scored = allUsers
    .filter((user) => user.id !== viewer.id)
    .map((user) => ({ user, breakdown: scoreCompatibility(viewer, toPublicUser(user)) }));

  const blocked: BlockerCode[] = [];
  const eligible = scored.filter(({ user }) => {
    if (swipedIds.has(user.id)) {
      blocked.push('already_swiped');
      return false;
    }

    // Both directions, tracked separately. Your own requirements and the fact
    // that someone filtered you out are different problems with different fixes,
    // and the empty state has to name the right one.
    const yours = checkEligibility(viewer, user);
    if (!yours.eligible) {
      blocked.push(...yours.failures);
      return false;
    }

    if (!checkEligibility(user, viewer).eligible) {
      blocked.push('their_requirements');
      return false;
    }

    return true;
  });

  eligible.sort((a, b) => b.breakdown.score - a.breakdown.score);

  const start = (page - 1) * pageSize;
  const items = eligible.slice(start, start + pageSize).map(({ user }) => toPublicUser(user));

  return {
    items,
    page,
    pageSize,
    total: eligible.length,
    hasMore: start + pageSize < eligible.length,
    // Only on an empty deck. On page 2 of a healthy one, "most people here are
    // blocked by your age range" would be true and useless.
    blockedReason: eligible.length === 0 ? summariseBlockers(blocked) : null,
  };
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
