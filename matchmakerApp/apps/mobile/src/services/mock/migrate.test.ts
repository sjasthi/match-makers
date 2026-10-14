import { MockDatabase } from './database';
import {
  normaliseLocation,
  normalisePreferences,
  normaliseStateUsers,
  normaliseState,
} from './migrate';
import { MAX_POST_TAGS } from '@match-makers/shared';
import { writeJson, persistentStore } from '@/services/storage/keyValueStore';
import type { Post } from '@match-makers/shared';
import { scoreCompatibility } from '@/utils/matching';
import { generateDemoUser, DEMO_EMAIL } from '@/utils/mockData';
import { Gender, RelationshipGoal, preferencesSchema } from '@match-makers/shared';
import type { User } from '@match-makers/shared';

const DB_KEY = 'mock.db.v2';

/** A questionnaire as it was stored before prompts existed. */
/** An FP3-era questionnaire, still on disk but no longer read by anything. */
const LEGACY = {
  values: ['kindness', 'emotional_openness'],
  importance: { kindness: 5, emotional_openness: 3 },
  dealBreakers: ['kindness'],
  interests: ['cooking', 'trail_running'],
  lifestyle: {
    schedule: 'flexible',
    exercise: 'moderate',
    kids: 'open',
    smoking: 'never',
    drinking: 'socially',
    pets: 'love_pets',
  },
};

describe('normalisePreferences', () => {
  it('reads a record with no distance mode as nearby', () => {
    // Every record written before the mode existed has a maxDistance and no way
    // of saying whether it was ever live. Reading it as global would quietly
    // double everyone's radius on upgrade.
    const { distanceMode: _absent, ...legacy } = generateDemoUser().preferences;
    expect(normalisePreferences(legacy).distanceMode).toBe('nearby');
  });

  it('keeps a global record global', () => {
    const result = normalisePreferences({
      ...generateDemoUser().preferences,
      distanceMode: 'global',
    });
    expect(result.distanceMode).toBe('global');
  });

  it('rejects a mode it does not recognise rather than defaulting it', () => {
    // Defaulting would turn a typo into a wider radius than the user chose.
    expect(normalisePreferences({ distanceMode: 'anywhere' }).distanceMode).toBe('nearby');
  });

  it('keeps the radius through a switch to global, so the round trip restores it', () => {
    const chosen = { ...generateDemoUser().preferences, maxDistance: 250, distanceMode: 'global' };
    expect(normalisePreferences(chosen).maxDistance).toBe(250);
  });

  it('clamps a radius the rules and schema would reject', () => {
    expect(normalisePreferences({ maxDistance: 9000 }).maxDistance).toBe(500);
    expect(normalisePreferences({ maxDistance: 0 }).maxDistance).toBe(1);
    expect(normalisePreferences({ maxDistance: 'far' }).maxDistance).toBe(50);
  });

  it('holds the age range coherent, so its own schema accepts the result', () => {
    const result = normalisePreferences({
      ageRange: { min: 40, max: 30 },
      genders: [Gender.FEMALE],
      relationshipGoals: [RelationshipGoal.LONG_TERM],
    });

    expect(result.ageRange.min).toBeLessThan(result.ageRange.max);
    expect(preferencesSchema.safeParse(result).success).toBe(true);
  });

  it('survives junk instead of throwing', () => {
    for (const junk of [undefined, null, 'nope', 42, []]) {
      const result = normalisePreferences(junk);
      expect(result.genders).toEqual([]);
      expect(result.relationshipGoals).toEqual([]);
      expect(result.distanceMode).toBe('nearby');
    }
  });

  it('leaves an already valid preference set untouched', () => {
    const demo = generateDemoUser();
    expect(normalisePreferences(demo.preferences)).toEqual(demo.preferences);
  });
});

describe('normaliseLocation', () => {
  it('leaves real coordinates alone', () => {
    const austin = {
      latitude: 30.2672,
      longitude: -97.7431,
      city: 'Austin',
      country: 'United States',
    };
    expect(normaliseLocation(austin)).toEqual(austin);
  });

  it('resolves the zero placeholder from the city label', () => {
    // The upgrade that matters. Left alone these profiles sit ~10,000 km from
    // everyone and are correctly excluded from every nearby deck, so shipping
    // the distance rules without this repair would have emptied everyone's feed.
    const result = normaliseLocation({
      latitude: 0,
      longitude: 0,
      city: 'Rotterdam',
      country: 'Netherlands',
    });

    expect(result.latitude).not.toBe(0);
    expect(result.longitude).not.toBe(0);
    // The city they typed is kept, not replaced by the catalog's spelling.
    expect(result.city).toBe('Rotterdam');
  });

  it('leaves an unresolvable city at zero rather than inventing coordinates', () => {
    const result = normaliseLocation({ latitude: 0, longitude: 0, city: 'Nowheresville' });
    expect(result).toEqual({
      latitude: 0,
      longitude: 0,
      city: 'Nowheresville',
      country: '',
    });
  });

  it('survives a location that is not an object at all', () => {
    for (const junk of [undefined, null, 'nope', 42]) {
      const result = normaliseLocation(junk);
      expect(result.latitude).toBe(0);
      expect(result.city).toBe('');
    }
  });
});

describe('normaliseStateUsers', () => {
  it('reports whether anything actually moved', () => {
    const demo = generateDemoUser();
    const alreadyFine = normaliseStateUsers([demo]);
    expect(alreadyFine.changed).toBe(false);

    // A record whose preferences predate `distanceMode` needs repairing; the
    // leftover questionnaire on it does not, because nothing reads it.
    const { distanceMode: _absent, ...preferences } = demo.preferences;
    const repaired = normaliseStateUsers([{ ...demo, preferences }]);

    expect(repaired.changed).toBe(true);
  });

  it('repairs a location and a distance mode in the same pass', () => {
    // Both changes arrive together for anyone who signed up before either, and
    // fixing only one leaves them with a mode that filters on nothing.
    const demo = generateDemoUser();
    const { distanceMode: _absent, ...preferences } = demo.preferences;

    const { users, changed } = normaliseStateUsers([
      {
        ...demo,
        preferences,
        location: { latitude: 0, longitude: 0, city: 'Lisbon', country: 'Portugal' },
      },
    ]);

    expect(changed).toBe(true);
    const stored = users[0] as User;
    expect(stored.preferences.distanceMode).toBe('nearby');
    expect(stored.location.latitude).toBeCloseTo(38.7223, 4);
  });

  it('leaves a record that passes the feed its old, loose radius', () => {
    // The regression that matters: after upgrading, the demo account should
    // still pass the same candidates it passed before.
    const demo = generateDemoUser();
    const { distanceMode: _absent, ...preferences } = demo.preferences;
    const { users } = normaliseStateUsers([{ ...demo, preferences }]);
    expect((users[0] as User).preferences).toEqual(demo.preferences);
  });

  it('flags a user list that is not a list at all', () => {
    expect(normaliseStateUsers('nope').changed).toBe(true);
    expect(normaliseStateUsers('nope').users).toEqual([]);
  });
});

describe('loading a stale database', () => {
  it('loads a record whose questionnaire nothing reads any more', async () => {
    const demo = generateDemoUser();
    // Exactly what an FP3 build left in storage. Nothing reads the key, but the
    // record still has to load, or the app would strand every account that
    // predates the photo feed.
    await writeJson(persistentStore, DB_KEY, {
      users: [{ ...demo, email: DEMO_EMAIL, password: demo.email, questionnaire: LEGACY }],
      currentUserId: null,
      swipes: [],
      matches: [],
      messages: [],
      posts: [],
      postReactions: [],
    });

    const state = await new MockDatabase().getState();
    const stored = state.users[0]!;

    expect(stored.id).toBe(demo.id);
    // Scoring reads the photo feed now, so a leftover questionnaire is inert
    // rather than a crash.
    expect(() => scoreCompatibility(stored, demo)).not.toThrow();
  });
});

describe('normaliseState (photo feed collections)', () => {
  const demo = generateDemoUser();

  function baseState(overrides: Record<string, unknown> = {}) {
    return {
      users: [demo],
      currentUserId: null,
      swipes: [],
      matches: [],
      messages: [],
      ...overrides,
    };
  }

  const CAT_POST = { id: 'post_cat', imageUri: '', tags: ['pet'], createdAt: '2026-01-01' };
  const MUSIC_POST = { id: 'post_music', imageUri: '', tags: ['music'], createdAt: '2026-01-02' };

  it('defaults the collections a pre-feed database never had', () => {
    // The regression this guards: an account created before the photo feed was
    // added has no `posts` or `postReactions` keys at all, and reading
    // `.filter` off undefined would crash the landing page on first open.
    const { state, changed } = normaliseState(baseState());

    expect(changed).toBe(true);
    expect((state as { posts: unknown[] }).posts).toEqual([]);
    expect((state as { postReactions: unknown[] }).postReactions).toEqual([]);
  });

  it('keeps the accounts rather than triggering a reseed', () => {
    const { state } = normaliseState(baseState());
    const users = (state as { users: User[] }).users;

    // Reseeding is what throws away every swipe and message somebody has, so
    // adding an append-only collection must never reach it.
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe(DEMO_EMAIL);
  });

  it('keeps well-formed posts and reactions', () => {
    const { state } = normaliseState(
      baseState({
        posts: [CAT_POST, MUSIC_POST],
        postReactions: [
          { id: 'r1', userId: 'user_demo', postId: 'post_cat', action: 'like', createdAt: '2026-01-03' },
        ],
      })
    );

    const next = state as { posts: unknown[]; postReactions: unknown[] };
    expect(next.posts).toHaveLength(2);
    expect(next.postReactions).toHaveLength(1);
  });

  it('drops a post with no usable tags rather than surfacing it in the feed', () => {
    // An untagged post can neither be rendered nor scored on, so keeping it
    // would push the failure into the feed where it looks like broken matching.
    const { state } = normaliseState(
      baseState({
        posts: [CAT_POST, { id: 'post_untagged', imageUri: '', tags: [], createdAt: '2026-01-01' }],
        postReactions: [],
      })
    );

    expect((state as { posts: Array<{ id: string }> }).posts.map((post) => post.id)).toEqual([
      'post_cat',
    ]);
  });

  it('keeps a tag the build has never seen before', () => {
    // Tags are free text now, so "the current build does not know this word" is
    // the normal case rather than a corrupt record. Under the closed set this
    // test asserted the opposite: an unknown tag was filtered out.
    const { state } = normaliseState(
      baseState({
        posts: [
          { id: 'post_new', imageUri: '', tags: ['underwater baking'], createdAt: '2026-01-01' },
        ],
        postReactions: [],
      })
    );

    expect((state as { posts: Array<{ tags: string[] }> }).posts[0]?.tags).toEqual([
      'underwater baking',
    ]);
  });

  it('folds a tag written with odd casing or spacing', () => {
    // The repair that matters for matching: a record holding `Dogs` next to one
    // holding `dog` would split a pair the admin believes is joined up. Folding
    // on load means an older or hand-written record cannot reintroduce that split.
    const { state } = normaliseState(
      baseState({
        posts: [
          { id: 'post_a', imageUri: '', tags: ['Dogs', '  HOT   DOG '], createdAt: '2026-01-01' },
        ],
        postReactions: [],
      })
    );

    expect((state as { posts: Array<{ tags: string[] }> }).posts[0]?.tags).toEqual([
      'dog',
      'hot dog',
    ]);
  });

  it('keeps the earliest of two tags that fold to the same thing', () => {
    // Order is meaningful: the first tag is the primary one a co-like is credited
    // to, so de-duplicating has to keep the earlier occurrence or a post tagged
    // `dog, cat, dog` would silently change subject.
    const { state } = normaliseState(
      baseState({
        posts: [
          { id: 'post_a', imageUri: '', tags: ['dog', 'cat', 'dogs'], createdAt: '2026-01-01' },
        ],
        postReactions: [],
      })
    );

    expect((state as { posts: Array<{ tags: string[] }> }).posts[0]?.tags).toEqual([
      'dog',
      'cat',
    ]);
  });

  it('caps a tag list that outgrew the limit', () => {
    const { state } = normaliseState(
      baseState({
        posts: [
          {
            id: 'post_a',
            imageUri: '',
            tags: Array.from({ length: 20 }, (_, index) => `tag${index}`),
            createdAt: '2026-01-01',
          },
        ],
        postReactions: [],
      })
    );

    expect(
      (state as { posts: Array<{ tags: string[] }> }).posts[0]?.tags
    ).toHaveLength(MAX_POST_TAGS);
  });

  it('drops a reaction pointing at a post that is gone', () => {
    // A dangling reaction would keep weighting somebody's taste on a tag they
    // can no longer see the subject of.
    const { state } = normaliseState(
      baseState({
        posts: [CAT_POST],
        postReactions: [
          { id: 'r1', userId: 'user_demo', postId: 'post_cat', action: 'like', createdAt: '2026-01-03' },
          { id: 'r2', userId: 'user_demo', postId: 'post_deleted', action: 'like', createdAt: '2026-01-03' },
        ],
      })
    );

    const reactions = (state as { postReactions: Array<{ id: string }> }).postReactions;
    expect(reactions.map((reaction) => reaction.id)).toEqual(['r1']);
  });

  it('drops a reaction with an unrecognised action', () => {
    const { state } = normaliseState(
      baseState({
        posts: [CAT_POST],
        postReactions: [
          { id: 'r1', userId: 'user_demo', postId: 'post_cat', action: 'love', createdAt: '2026-01-03' },
        ],
      })
    );

    expect((state as { postReactions: unknown[] }).postReactions).toEqual([]);
  });

  it('leaves a healthy state alone', () => {
    const { changed } = normaliseState(
      baseState({ posts: [CAT_POST], postReactions: [] })
    );
    expect(changed).toBe(false);
  });
});

describe('a post stored before the importer wrote two copies', () => {
  const demo = generateDemoUser();

  function postsThrough(input: Array<Record<string, unknown>>) {
    const { state } = normaliseState({
      users: [demo],
      posts: input,
      postReactions: [],
    });
    return (state as { posts: Post[] }).posts;
  }

  it('keeps a single-uri post exactly as it was', () => {
    const posts = postsThrough([
      { id: 'post_old', imageUri: 'file:///cache/1200.jpg', tags: ['dog'], createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    // No thumb is derived here. Rewriting every stored photo on load is exactly
    // what this function exists to avoid, and the grid already falls back.
    expect(posts[0]).toEqual({
      id: 'post_old',
      imageUri: 'file:///cache/1200.jpg',
      tags: ['dog'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(posts[0]?.thumbUri).toBeUndefined();
  });

  it('carries the second copy and dimensions through when they are there', () => {
    const posts = postsThrough([
      {
        id: 'post_new',
        imageUri: 'file:///cache/1200.jpg',
        thumbUri: 'file:///cache/640.jpg',
        width: 1200,
        height: 900,
        tags: ['dog'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(posts[0]?.thumbUri).toBe('file:///cache/640.jpg');
    expect(posts[0]?.width).toBe(1200);
    expect(posts[0]?.height).toBe(900);
  });

  it('drops a nonsensical dimension rather than storing it', () => {
    // The viewer sizes its card from these. A zero or negative would collapse the
    // layout instead of falling back the way an absent value does.
    const posts = postsThrough([
      {
        id: 'post_bad',
        imageUri: 'file:///cache/1200.jpg',
        width: 0,
        height: -5,
        tags: ['dog'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(posts[0]?.width).toBeUndefined();
    expect(posts[0]?.height).toBeUndefined();
  });

  it('treats an empty thumb as no thumb at all', () => {
    // An empty string would send the grid to a file that does not exist, which
    // is worse than falling back to the full image.
    const posts = postsThrough([
      { id: 'post_empty', imageUri: 'file:///cache/1200.jpg', thumbUri: '', tags: ['dog'], createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    expect(posts[0]?.thumbUri).toBeUndefined();
  });
});

describe('a record written before the photo feed', () => {
  const demo = generateDemoUser();

  it('keeps an unknown questionnaire key without failing', () => {
    // Records written under FP3 carry a `questionnaire` that nothing reads any
    // more. Tolerating an unknown key is free; a migration that deletes or
    // rewrites it can fail on data nobody looks at.
    const legacy = { ...demo, questionnaire: { values: ['kindness'], prompts: [] } };
    const { state, changed } = normaliseState({
      users: [legacy],
      posts: [],
      postReactions: [],
    });

    const stored = (state as { users: Array<Record<string, unknown>> }).users[0]!;
    expect(stored.id).toBe(demo.id);
    expect(stored.questionnaire).toEqual({ values: ['kindness'], prompts: [] });
    // Nothing about the record needed repairing, so nothing was rewritten.
    expect(changed).toBe(false);
  });
});
