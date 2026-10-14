import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { setActiveAuthMode } from '@/services/auth';
import { fetchTasteSummary } from '@/services/posts';
import { fetchFeed } from '@/services/feed';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import { mutualGate } from '@/utils/eligibility';
import { RelationshipGoal } from '@match-makers/shared';
import type { Post, PostReaction, User } from '@match-makers/shared';

jest.setTimeout(60_000);

const AUSTIN = { latitude: 30.2672, longitude: -97.7431, city: 'Austin', country: 'United States' };

async function signInDemo() {
  await mockDb.reset();
  const adapter = new MockAuthAdapter();
  await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  return adapter;
}

function reactionsFor(userId: string): Promise<PostReaction[]> {
  return mockDb.allPostReactions().then((all) => all.filter((r) => r.userId === userId));
}

/**
 * Makes `target` share as many photos with the demo as possible, by clearing the
 * field so only this one person overlaps.
 */
async function makeClosest(target: User): Promise<void> {
  const posts = await mockDb.allPosts();

  // Everyone else answers everything differently, so the only person the demo
  // shares anything with is the one under test.
  for (const reaction of await mockDb.allPostReactions()) {
    if (reaction.userId === 'user_demo' || reaction.userId === target.id) continue;
    await mockDb.recordPostReaction(reaction.userId, reaction.postId, 'dislike');
  }
  for (const other of (await mockDb.allUsers()).filter(
    (user) => user.id !== 'user_demo' && user.id !== target.id
  )) {
    await mockDb.saveUser({ ...other, relationshipGoal: RelationshipGoal.FRIENDSHIP });
  }

  // The target keeps their seeded likes; the demo is given the same ones.
  const theirs = (await reactionsFor(target.id)).filter((r) => r.action === 'like');
  for (const reaction of theirs) {
    await mockDb.recordPostReaction('user_demo', reaction.postId, 'like');
  }

  expect(posts.length).toBeGreaterThan(0);
}

/** Moves somebody permanently out of the demo's radius. */
async function putOutOfRange(user: User & { password: string }): Promise<void> {
  await mockDb.saveUser({
    ...user,
    location: { latitude: 51.5072, longitude: -0.1276, city: 'London', country: 'United Kingdom' },
  });
}

beforeEach(() => {
  mockDb.reset();
});

afterEach(async () => {
  await setActiveAuthMode('mock');
});

describe('the people a summary may name', () => {
  it('never names somebody the deck would refuse to show', async () => {
    await signInDemo();
    const others = (await mockDb.allUsers()).filter((user) => user.id !== 'user_demo');
    const target = others[0]!;

    // Built to be the strongest possible match: the only person sharing photos.
    await makeClosest(target);
    await putOutOfRange(target);

    const summary = await fetchTasteSummary();

    // The bug. The summary used to hand every account to `closestByTaste`, so it
    // would name as "closest" people the deck had already filtered out — the app
    // promising a consequence it had ruled out.
    expect(summary.closest.map((entry) => entry.userId)).not.toContain(target.id);
  });

  it('says the filters are the reason, rather than blaming the answers', async () => {
    await signInDemo();
    const others = (await mockDb.allUsers()).filter((user) => user.id !== 'user_demo');

    // Overlap first, filters second. With no answers there is nobody to be
    // blocked, and "your filters" would be the wrong thing to say.
    for (const post of await mockDb.allPosts()) {
      await mockDb.recordPostReaction('user_demo', post.id, 'like');
    }
    for (const user of others) await putOutOfRange(user);

    const summary = await fetchTasteSummary();

    expect(summary.closest).toHaveLength(0);
    // Somebody does overlap, just not inside the radius. Without this flag the
    // screen would tell them to answer more photos, which is not the problem.
    expect(summary.closestBlockedByFilters).toBe(true);
  });

  it('leaves the flag off when nobody overlaps at all', async () => {
    await signInDemo();

    // A single dislike leaves no shared positive evidence with anybody.
    const [post] = await mockDb.allPosts();
    await mockDb.recordPostReaction('user_demo', (post as Post).id, 'dislike');

    const summary = await fetchTasteSummary();

    expect(summary.closest).toHaveLength(0);
    // "You have not answered enough" is the honest message here, so the filter
    // wording would be a lie.
    expect(summary.closestBlockedByFilters).toBe(false);
  });

  it('names only people the deck also lists', async () => {
    await signInDemo();
    const [post] = await mockDb.allPosts();
    await mockDb.recordPostReaction('user_demo', (post as Post).id, 'like');

    const summary = await fetchTasteSummary();
    const deck = await fetchFeed(1, 50);
    const inDeck = new Set(deck.items.map((item) => item.user.id));

    // The two screens are two views of one rule. If this fails they have drifted
    // again, which is how the original bug happened.
    for (const entry of summary.closest) {
      expect(inDeck.has(entry.userId)).toBe(true);
    }
  });
});

describe('the number on a summary card', () => {
  it('is the same percentage the deck card shows', async () => {
    await signInDemo();
    const [post] = await mockDb.allPosts();
    await mockDb.recordPostReaction('user_demo', (post as Post).id, 'like');

    const summary = await fetchTasteSummary();
    const deck = await fetchFeed(1, 50);

    expect(summary.closest.length).toBeGreaterThan(0);
    for (const entry of summary.closest) {
      const card = deck.items.find((item) => item.user.id === entry.userId);
      expect(card).toBeDefined();
      // Two different percentages for the same word "match", on two screens a
      // swipe apart, is how "who is closest" became unanswerable from the UI.
      expect(entry.score).toBe(card!.compatibility.score);
    }
  });

  it('carries enough of the signal to rebuild the breakdown downstream', async () => {
    await signInDemo();
    const [post] = await mockDb.allPosts();
    await mockDb.recordPostReaction('user_demo', (post as Post).id, 'like');

    const summary = await fetchTasteSummary();

    // Tapping through to the profile hands this to the detail screen. Without it
    // the detail page re-derives the breakdown with no signal and contradicts
    // the card that sent you there.
    for (const entry of summary.closest) {
      expect(entry.affinity).toBeGreaterThan(0);
      // Either half of the signal may carry a pair on its own: two people can
      // share a tag without having liked the same photo, and the reverse. What
      // must hold is that at least one of them is there to rebuild the reason.
      expect(entry.coLikedPosts > 0 || entry.sharedTags.length > 0).toBe(true);
      expect(entry.reason).toContain('You both');
    }
  });
});

describe('the demo account\'s own filters', () => {
  it('does not exclude seeded candidates on relationship goal', async () => {
    const adapter = await signInDemo();
    const viewer = (await adapter.getCurrentUser())!;
    const others = (await mockDb.allUsers()).filter((user) => user.id !== 'user_demo');

    for (const candidate of others) {
      // Candidates are assigned goals including `friendship`, which the demo's
      // accept-list omitted. That quietly removed about a quarter of the pool
      // through the demo's own gate, with nothing on screen to say so.
      expect(mutualGate(viewer, candidate).blockedByYou).not.toContain('goal');
    }
  });

  it('keeps the demo inside its own stated radius', async () => {
    const viewer = (await (await signInDemo()).getCurrentUser())!;

    expect(viewer.location).toEqual(AUSTIN);
    expect(viewer.preferences.distanceMode).toBe('nearby');
  });
});