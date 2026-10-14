import type { User } from '@match-makers/shared';
import { normaliseTag } from '@match-makers/shared';
import {
  generateMockUsers,
  generateDemoUser,
  generateSeedPosts,
  seedReactionsFor,
} from './mockData';
import { findCityCentroid } from './cityCatalog';
import { distanceKm, hasCoordinates } from './distance';

describe('seeded photo library', () => {
  it('gives every seeded post at least one tag', () => {
    const posts = generateSeedPosts(24);
    expect(posts.length).toBe(24);
    for (const post of posts) {
      expect(post.tags.length).toBeGreaterThan(0);
    }
  });

  it('writes tags in the canonical form, so the seed needs no folding', () => {
    // The importer folds on write and the migration folds on load. The seed
    // skipping that is only safe because it is already canonical, and a change to
    // the fold rule would quietly corrupt the shipped data otherwise.
    for (const post of generateSeedPosts(24)) {
      for (const tag of post.tags) {
        expect(normaliseTag(tag)).toBe(tag);
      }
    }
  });

  it('never writes a post with no image and no way to tell what it is', () => {
    for (const post of generateSeedPosts(24)) {
      expect(post.imageUri === '' || post.imageUri.length > 0).toBe(true);
      expect(post.tags.length).toBeGreaterThan(0);
    }
  });

  it('uses more than one tag, so the grid is not one flat category', () => {
    const tags = new Set(generateSeedPosts(24).flatMap((post) => post.tags));
    expect(tags.size).toBeGreaterThan(4);
  });

  it('gives candidates reactions, so the taste signal has somebody to compare', () => {
    const users = generateMockUsers(5);
    const posts = generateSeedPosts(24);
    const reactions = seedReactionsFor(users, posts);

    expect(reactions.length).toBeGreaterThan(0);
    for (const reaction of reactions) {
      expect(users.some((user) => user.id === reaction.userId)).toBe(true);
      expect(posts.some((post) => post.id === reaction.postId)).toBe(true);
    }
  });

  it('never seeds the same person twice for the same photo', () => {
    // A duplicate would double-count that photo in the taste index.
    const users = generateMockUsers(5);
    const reactions = seedReactionsFor(users, generateSeedPosts(24));
    const keys = reactions.map((reaction) => `${reaction.userId}:${reaction.postId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every candidate reactions above the confidence floor', () => {
    // Below five likes the affinity signal is damped towards nothing, so a seeded
    // candidate that never clears it would read as incompatible with everybody.
    const users = generateMockUsers(10);
    const reactions = seedReactionsFor(users, generateSeedPosts(24));
    for (const user of users) {
      const likes = reactions.filter(
        (reaction) => reaction.userId === user.id && reaction.action === 'like'
      ).length;
      expect(likes).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('seeded locations', () => {
  const candidates = generateMockUsers(20);
  const demo = generateDemoUser() as User;
  const distances = candidates.map((user) => distanceKm(demo.location, user.location));

  it('gives every candidate usable coordinates', () => {
    // Before this, coordinates were drawn uniformly from the globe, so a
    // distance filter had nothing it could keep and every deck came back empty.
    const unusable = candidates.filter((user) => !hasCoordinates(user.location));
    expect(unusable.map((user) => user.id)).toEqual([]);
  });

  it('keeps a city label consistent with the coordinates attached to it', () => {
    for (const user of candidates) {
      const centroid = findCityCentroid(user.location.city, user.location.country);
      expect(centroid).not.toBeNull();
      expect(distanceKm(centroid!, user.location)).toBeLessThan(400);
    }
  });

  it("fills the demo account's nearby radius", () => {
    // The demo account is set to 50 km. If this ever drops to zero the feed is
    // empty on first launch, which reads as a broken matcher rather than as an
    // empty seed.
    const withinRadius = distances.filter((km) => km <= demo.preferences.maxDistance).length;
    expect(withinRadius).toBeGreaterThanOrEqual(6);
  });

  it('leaves people out of that radius, so the limit is doing something', () => {
    // A radius that excludes nobody is not a filter, and the global toggle would
    // have nothing to demonstrate.
    const beyondRadius = distances.filter((km) => km > demo.preferences.maxDistance).length;
    expect(beyondRadius).toBeGreaterThanOrEqual(4);
  });

  it('widens the deck when the demo account switches to global', () => {
    const nearby = distances.filter((km) => km <= demo.preferences.maxDistance).length;
    expect(distances.length).toBeGreaterThan(nearby);
  });

  it("places most candidates in the demo account's own city", () => {
    const sameCity = candidates.filter((user) => user.location.city === demo.location.city);
    expect(sameCity.length).toBeGreaterThanOrEqual(6);
  });
});

describe('demo account', () => {
  it('is not random, so the demo always tells the same story', () => {
    // The demo used to carry a fixed questionnaire for this reason. It has no
    // questionnaire now, so the guarantee is that the whole persona is identical
    // between two seeds.
    //
    // The two timestamps are excluded because they are the real clock, not seeded
    // content, and two calls a millisecond apart must not read as a difference.
    // Excluding them by hand rather than with a matcher so that anything added to
    // the demo later is still covered by default.
    const {
      createdAt: _seededCreatedAt,
      updatedAt: _seededUpdatedAt,
      ...first
    } = generateDemoUser();
    const {
      createdAt: _seededCreatedAt2,
      updatedAt: _seededUpdatedAt2,
      ...second
    } = generateDemoUser();

    expect(first).toEqual(second);
  });

  it('starts on a nearby radius, so the global toggle has something to reveal', () => {
    const demo = generateDemoUser();
    expect(demo.preferences.distanceMode).toBe('nearby');
    expect(demo.preferences.maxDistance).toBeGreaterThan(0);
  });
});

describe('seeded preferences', () => {
  it('leaves candidates permissive, so the viewer is the constrained side', () => {
    // Matching is mutual. If the seed handed candidates a 50 km radius and a
    // narrow age range, their limits would bind before the viewer's and the
    // demo would show nothing about the viewer's own settings.
    for (const user of generateMockUsers(20)) {
      expect(user.preferences.distanceMode).toBe('global');
      expect(user.preferences.ageRange.min).toBeLessThanOrEqual(25);
      expect(user.preferences.ageRange.max).toBeGreaterThanOrEqual(40);
    }
  });

  it('never seeds a radius the distance filter would have to fight', () => {
    for (const user of generateMockUsers(20)) {
      expect(user.preferences.maxDistance).toBeGreaterThan(0);
      expect(user.preferences.maxDistance).toBeLessThanOrEqual(500);
    }
  });
});

describe('the relationship goal gate', () => {
  it('has every seeded user accept their own goal', () => {
    // The gate is mutual: you are shown only people whose accept-list you are on
    // AND who have you on theirs. A user whose own goal is missing from their own
    // accept-list therefore excludes themselves from everyone like them, which is
    // how the demo account once ended up with a completely empty deck.
    for (const user of [...generateMockUsers(25), generateDemoUser()]) {
      expect(user.preferences.relationshipGoals).toContain(user.relationshipGoal);
    }
  });
});
