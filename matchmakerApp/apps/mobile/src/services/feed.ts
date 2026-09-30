import type { User } from '@match-makers/shared';
import { getApiClient } from '@/services/api/client';
import { getAuthAdapter } from '@/services/auth';
import { mockDb, toPublicUser } from '@/services/mock/database';
import { simulateLatency, maybeSimulateFailure } from '@/services/mock/network';
import { scoreCompatibility } from '@/utils/matching';
import { ageFromDateOfBirth } from '@/utils/mockData';
import type { FeedPage, SwipeOutcome, SwipeType } from '@/types';

const DEFAULT_PAGE_SIZE = 10;

async function buildMockFeed(page: number, pageSize: number): Promise<FeedPage> {
  const adapter = getAuthAdapter();
  const viewer = await adapter.getCurrentUser();
  if (!viewer) return { items: [], page, pageSize, total: 0, hasMore: false };

  const [allUsers, swipedIds] = await Promise.all([
    mockDb.allUsers(),
    mockDb.swipedUserIds(viewer.id),
  ]);

  const eligible = allUsers
    .filter((user) => user.id !== viewer.id && !swipedIds.has(user.id))
    .map((user) => ({ user, breakdown: scoreCompatibility(viewer, toPublicUser(user)) }))
    .filter(({ user }) => {
      const age = ageFromDateOfBirth(user.dateOfBirth);
      return (
        age >= viewer.preferences.ageRange.min &&
        age <= viewer.preferences.ageRange.max &&
        viewer.preferences.genders.includes(user.gender)
      );
    })
    .sort((a, b) => b.breakdown.score - a.breakdown.score);

  const start = (page - 1) * pageSize;
  const items = eligible.slice(start, start + pageSize).map(({ user }) => toPublicUser(user));

  return {
    items,
    page,
    pageSize,
    total: eligible.length,
    hasMore: start + pageSize < eligible.length,
  };
}

export async function fetchFeed(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<FeedPage> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();
    return buildMockFeed(page, pageSize);
  }

  const response = await getApiClient().get<{
    items: User[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }>('/feed', { params: { page, pageSize } });
  return response.data;
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
