import type { Post, PostReaction, PostReactionAction, User } from '@match-makers/shared';
import type { PhotoFeedPage } from '@match-makers/shared';

import { getApiClient } from '@/services/api/client';
import { getAuthAdapter } from '@/services/auth';
import { mockDb, toPublicUser } from '@/services/mock/database';
import { simulateLatency, maybeSimulateFailure } from '@/services/mock/network';
import { buildTasteIndex, closestByTaste, opinionsFor, tasteBetween } from '@/utils/taste';
import { mutualGate } from '@/utils/eligibility';
import { scoreCompatibility } from '@/utils/matching';
import type { TasteSummary } from '@match-makers/shared';

/** How many people the "closest" list names. */
const CLOSEST_LIMIT = 3;

/**
 * One page of the photo feed, plus what the viewer's reactions have taught us.
 *
 * Both halves come from one call because they are two views of the same
 * reactions table and the screen has to show them together. Fetching the posts
 * and then the taste separately would let the summary describe a different set
 * of reactions than the one the feed was built from, which is the kind of race
 * that only shows up on a slow connection.
 */
export async function fetchPhotoFeed(): Promise<PhotoFeedPage> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();
    return buildMockPhotoFeed();
  }

  const response = await getApiClient().get<PhotoFeedPage>('/posts/feed');
  return response.data;
}

/**
 * The whole library, with this caller's answers attached.
 *
 * Answered photos are *not* filtered out. They used to be, which made the feed a
 * shrinking work queue — and then there was no way to change your mind, because
 * the photo you wanted to un-answer had already left the screen. Returning
 * everything and reporting the answers separately is what makes undo possible.
 *
 * The order is library order and stays that way. Re-sorting answered photos
 * towards the bottom would read as a work queue, but it would also rearrange the
 * grid on every single tap and lose the person's place in it.
 */
async function buildMockPhotoFeed(): Promise<PhotoFeedPage> {
  const adapter = getAuthAdapter();
  const viewer = await adapter.getCurrentUser();
  if (!viewer) {
    return { posts: [], reactions: {}, total: 0, summary: emptySummary() };
  }

  const [posts, reactions, users] = await Promise.all([
    mockDb.allPosts(),
    mockDb.allPostReactions(),
    mockDb.allUsers(),
  ]);

  // Only this caller's answers. Everyone else's are in the same table and are
  // what the summary reads, but they have no business rendering as state on
  // somebody else's tile.
  const mine: Record<string, PostReactionAction> = {};
  for (const reaction of reactions) {
    if (reaction.userId === viewer.id) mine[reaction.postId] = reaction.action;
  }

  return {
    posts,
    reactions: mine,
    total: posts.length,
    summary: buildSummary(reactions, posts, users, viewer),
  };
}

/**
 * The running tally shown under the feed.
 *
 * `closest` is the part that makes the feature legible: without it the feed is a
 * row of taps with no stated consequence, and "we are learning what you like"
 * is not something anybody has to take on faith.
 */
function buildSummary(
  reactions: PostReaction[],
  posts: Post[],
  users: User[],
  viewer: User
): TasteSummary {
  const index = buildTasteIndex(reactions, posts);
  const mine = reactions.filter((reaction) => reaction.userId === viewer.id);

  const everyone = users.filter((user) => user.id !== viewer.id);

  // The same gate the deck applies, so the two screens cannot name different
  // people. `toPublicUser` only strips the password, so preferences, location
  // and date of birth all survive for the gate to read.
  const eligible = everyone.filter((user) => mutualGate(viewer, user).eligible);
  const blocked = everyone.filter((user) => !mutualGate(viewer, user).eligible);

  // Whether anybody worth naming was filtered out, so the empty state can say so
  // rather than telling somebody to answer more photos when the answer is that
  // their filters already ruled them out.
  const overlaps = (pool: User[]) =>
    pool.some((user) => tasteBetween(index, viewer.id, user.id).affinity > 0);

  const closest = closestByTaste(
    index,
    viewer.id,
    eligible.map((user) => ({ id: user.id, name: user.name })),
    CLOSEST_LIMIT
  );

  return {
    likes: mine.filter((reaction) => reaction.action === 'like').length,
    dislikes: mine.filter((reaction) => reaction.action === 'dislike').length,
    tags: opinionsFor(index, viewer.id),
    // Scored through the deck's own function so the percentage here cannot
    // disagree with the one on the card the deck puts in front of them.
    closest: closest.map((entry) => {
      const candidate = eligible.find((user) => user.id === entry.userId) as User;
      return {
        ...entry,
        score: scoreCompatibility(viewer, candidate, entry).score,
      };
    }),
    closestBlockedByFilters: closest.length === 0 && overlaps(blocked),
  };
}

function emptySummary(): TasteSummary {
  return { likes: 0, dislikes: 0, tags: [], closest: [] };
}

/**
 * Records the viewer's answer to a post.
 *
 * Returns the reaction so the caller can tell the difference between an update
 * (they had already answered this one) and a new one. The photo feed never shows
 * an already-answered post, so in practice this is always new, but the upsert is
 * real rather than defensive.
 */
export async function reactToPost(
  postId: string,
  action: PostReactionAction
): Promise<PostReaction> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();

    const adapter = getAuthAdapter();
    const viewer = await adapter.getCurrentUser();
    if (!viewer) throw new Error('You need to be signed in to react to a photo');

    const post = await mockDb.findPostById(postId);
    if (!post) throw new Error('That photo is no longer available');

    return mockDb.recordPostReaction(viewer.id, postId, action);
  }

  const response = await getApiClient().post<PostReaction>('/posts/reactions', { postId, action });
  return response.data;
}

/**
 * Takes back an answer, leaving the photo back in its default unanswered state.
 *
 * Separate from `reactToPost` rather than a third `action` value, because
 * "unlike" and "clear" are the same request with opposite intent and a caller
 * that passes `'undo'` as an action would be storing a row that the taste index
 * counts as a reaction.
 */
export async function undoPostReaction(postId: string): Promise<boolean> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();

    const adapter = getAuthAdapter();
    const viewer = await adapter.getCurrentUser();
    if (!viewer) throw new Error('You need to be signed in to change your answer');

    return mockDb.removePostReaction(viewer.id, postId);
  }

  const response = await getApiClient().delete<{ removed: boolean }>(`/posts/reactions/${postId}`);
  return response.data.removed;
}

/**
 * The summary on its own, for refreshing the strip without refetching posts.
 *
 * Called after a reaction settles, which is why it exists separately from
 * `fetchPhotoFeed`: reloading the whole feed to redraw one line of text would
 * reorder the posts under the person who is looking at them.
 */
export async function fetchTasteSummary(): Promise<TasteSummary> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();

    const adapter = getAuthAdapter();
    const viewer = await adapter.getCurrentUser();
    if (!viewer) return emptySummary();

    const [posts, reactions, users] = await Promise.all([
      mockDb.allPosts(),
      mockDb.allPostReactions(),
      mockDb.allUsers(),
    ]);

    return buildSummary(reactions, posts, users.map(toPublicUser), viewer);
  }

  const response = await getApiClient().get<{ summary: TasteSummary }>('/posts/taste');
  return response.data.summary;
}

/** Total posts in the library, so the feed can say whether it is empty or spent. */
export async function fetchPostCount(): Promise<number> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();
    return (await mockDb.allPosts()).length;
  }
  const response = await getApiClient().get<{ total: number }>('/posts', { params: { pageSize: 1 } });
  return response.data.total;
}