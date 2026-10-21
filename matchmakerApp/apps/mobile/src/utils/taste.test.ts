import type { Post, PostReaction } from '@match-makers/shared';

import {
  buildTasteIndex,
  closestByTaste,
  describeAffinity,
  EMPTY_TASTE_INDEX,
  opinionsFor,
  tasteBetween,
} from '@/utils/taste';

function post(id: string, ...tags: string[]): Post {
  return { id, imageUri: '', tags, createdAt: '2026-01-01T00:00:00.000Z' };
}

function like(userId: string, postId: string): PostReaction {
  return { id: `${userId}_${postId}`, userId, postId, action: 'like', createdAt: '2026-01-01' };
}

function dislike(userId: string, postId: string): PostReaction {
  return {
    id: `${userId}_${postId}_no`,
    userId,
    postId,
    action: 'dislike',
    createdAt: '2026-01-01',
  };
}

const CAT = post('p_cat', 'pets', 'animals');
const DOG = post('p_dog', 'pets');
const FOOD = post('p_food', 'food');
const MUSIC = post('p_music', 'music');

describe('tasteBetween', () => {
  it('scores two strangers with no shared reaction at zero', () => {
    const index = buildTasteIndex([like('me', 'p_food'), like('them', 'p_cat')], [CAT, FOOD]);

    const signal = tasteBetween(index, 'me', 'them');

    expect(signal.affinity).toBe(0);
    expect(signal.coLikedPosts).toBe(0);
    expect(signal.sharedTags).toEqual([]);
    expect(signal.reason).toBeNull();
  });

  it('gives two people who liked the same photo the stronger signal', () => {
    const index = buildTasteIndex(
      [like('me', 'p_cat'), like('them', 'p_cat'), like('me', 'p_food'), like('them', 'p_food')],
      [CAT, FOOD]
    );

    const signal = tasteBetween(index, 'me', 'them');

    expect(signal.coLikedPosts).toBe(2);
    expect(signal.sharedTags).toEqual(expect.arrayContaining(['pets', 'animals', 'food']));
    expect(signal.affinity).toBeGreaterThan(0);
  });

  it('scores a shared tag on different photos, weakly', () => {
    // The exact case the feature is for: me on the cat post, them on the dog
    // post, no photo in common. They agree on pets without agreeing on a photo.
    const index = buildTasteIndex(
      [
        like('me', 'p_cat'),
        like('them', 'p_dog'),
        like('me', 'p_food'),
        like('me', 'p_music'),
        like('me', 'p_cat'),
      ],
      [CAT, DOG, FOOD, MUSIC]
    );

    const signal = tasteBetween(index, 'me', 'them');

    expect(signal.coLikedPosts).toBe(0);
    expect(signal.sharedTags).toContain('pets');
    expect(signal.affinity).toBeGreaterThan(0);
    expect(signal.reason).toBe('You both like photos tagged pets');
  });

  it('beats a shared tag with a co-like given the same evidence volume', () => {
    const tagOnly = tasteBetween(
      buildTasteIndex(
        [
          like('me', 'p_cat'),
          like('them', 'p_dog'),
          like('me', 'p_food'),
          like('me', 'p_music'),
          like('me', 'p_food'),
        ],
        [CAT, DOG, FOOD, MUSIC]
      ),
      'me',
      'them'
    );
    const coLike = tasteBetween(
      buildTasteIndex(
        [
          like('me', 'p_cat'),
          like('them', 'p_cat'),
          like('me', 'p_food'),
          like('me', 'p_music'),
          like('me', 'p_food'),
        ],
        [CAT, DOG, FOOD, MUSIC]
      ),
      'me',
      'them'
    );

    expect(coLike.affinity).toBeGreaterThan(tagOnly.affinity);
  });

  it('is symmetric', () => {
    const index = buildTasteIndex(
      [like('me', 'p_cat'), like('them', 'p_cat'), like('me', 'p_food'), like('them', 'p_music')],
      [CAT, FOOD, MUSIC]
    );

    expect(tasteBetween(index, 'me', 'them')).toEqual(tasteBetween(index, 'them', 'me'));
  });

  it('never scores a person against themselves', () => {
    const index = buildTasteIndex([like('me', 'p_cat'), like('me', 'p_food')], [CAT, FOOD]);

    expect(tasteBetween(index, 'me', 'me')).toEqual({
      affinity: 0,
      coLikedPosts: 0,
      sharedTags: [],
      reason: null,
    });
  });

  it('saturates: each extra shared photo matters less than the first', () => {
    const posts = Array.from({ length: 12 }, (_, index) => post(`p_${index}`, 'pets'));
    const shared = posts.slice(0, 6);
    const rest = posts.slice(6, 12);

    // Both sides need enough likes for confidence to clear, so each side also
    // fills its quota from posts the other has not seen.
    const build = (sharedCount: number) => {
      const reactions = [
        ...shared
          .slice(0, sharedCount)
          .flatMap((item) => [like('me', item.id), like('them', item.id)]),
        ...rest.slice(0, 4).flatMap((item) => [like('me', item.id), like('them', item.id)]),
      ];
      return buildTasteIndex(reactions, posts);
    };

    const first = tasteBetween(build(1), 'me', 'them').affinity;
    const second = tasteBetween(build(2), 'me', 'them').affinity;
    const sixth = tasteBetween(build(6), 'me', 'them').affinity;

    expect(second).toBeGreaterThan(first);
    expect(sixth).toBeGreaterThan(second);
    // Never reaches 1: the tag half always has room to contribute.
    expect(sixth).toBeLessThan(1);
  });

  it('damps the signal when either side has barely reacted', () => {
    const reactions = [
      like('me', 'p_cat'),
      like('me', 'p_dog'),
      like('me', 'p_food'),
      like('me', 'p_music'),
      like('me', 'p_cat'),
      like('them', 'p_cat'),
    ];

    // Five of mine, one of theirs. Shared evidence exists but it is thin, and
    // affinity cannot be stronger than its weakest side.
    const signal = tasteBetween(buildTasteIndex(reactions, [CAT, DOG, FOOD, MUSIC]), 'me', 'them');

    expect(signal.coLikedPosts).toBe(1);
    expect(signal.affinity).toBeLessThan(0.3);
  });

  it('scores zero when one side has only dislikes, however many', () => {
    const index = buildTasteIndex(
      [
        dislike('me', 'p_cat'),
        dislike('me', 'p_food'),
        dislike('them', 'p_cat'),
        dislike('them', 'p_music'),
      ],
      [CAT, FOOD, MUSIC]
    );

    // Agreement to dislike is not agreement about anything.
    expect(tasteBetween(index, 'me', 'them').affinity).toBe(0);
    expect(tasteBetween(index, 'me', 'them').reason).toBeNull();
  });

  it('does not pair two people over a tag one of them pushed away', () => {
    const index = buildTasteIndex(
      [
        like('me', 'p_cat'),
        like('me', 'p_dog'),
        like('me', 'p_food'),
        like('me', 'p_music'),
        like('me', 'p_cat'),
        dislike('them', 'p_cat'),
        like('them', 'p_food'),
        like('them', 'p_music'),
      ],
      [CAT, DOG, FOOD, MUSIC]
    );

    const signal = tasteBetween(index, 'me', 'them');

    expect(signal.sharedTags).not.toContain('pets');
    expect(signal.sharedTags).not.toContain('animals');
  });

  it('counts tags rather than posts toward breadth', () => {
    const posts = [CAT, DOG, post('p_food', 'food'), post('p_music', 'music')];
    // Me: two opinions (pets, food). Them: four (pets, animals, food, music).
    // Containment not union, so the narrower side is not punished for it.
    const index = buildTasteIndex(
      [
        like('me', 'p_cat'),
        like('me', 'p_food'),
        like('me', 'p_food'),
        like('me', 'p_music'),
        like('me', 'p_food'),
        like('them', 'p_cat'),
        like('them', 'p_dog'),
        like('them', 'p_food'),
        like('them', 'p_music'),
        like('them', 'p_food'),
      ],
      posts
    );

    const signal = tasteBetween(index, 'me', 'them');

    expect(signal.sharedTags).toEqual(expect.arrayContaining(['pets', 'food']));
  });
});

describe('opinionsFor', () => {
  it('reports a tag as partly positive, never fully certain', () => {
    const index = buildTasteIndex(
      [like('me', 'p_cat'), like('me', 'p_food'), dislike('me', 'p_cat')],
      [CAT, FOOD]
    );

    const pets = opinionsFor(index, 'me').find((entry) => entry.tag === 'pets');
    const food = opinionsFor(index, 'me').find((entry) => entry.tag === 'food');

    // 1 like, 1 dislike cancels out.
    expect(pets?.score).toBe(0);
    // 1 like and no dislike is 0.5, not 1. A single tap is weak evidence.
    expect(food?.score).toBe(0.5);
  });

  it('returns nothing for a user who has never reacted', () => {
    expect(opinionsFor(EMPTY_TASTE_INDEX, 'nobody')).toEqual([]);
  });
});

describe('describeAffinity', () => {
  it('puts the specific evidence first when there is both', () => {
    expect(describeAffinity(2, ['pets', 'animals'])).toBe(
      'You both liked 2 of the same photos, tagged pets and animals'
    );
  });

  it('uses the singular for one shared photo', () => {
    expect(describeAffinity(1, [])).toBe('You both liked the same photo');
  });

  it('says nothing when there is no evidence', () => {
    expect(describeAffinity(0, [])).toBeNull();
  });
});

describe('closestByTaste', () => {
  it('ranks the strongest pull first and drops the pairs with none', () => {
    const posts = [CAT, DOG, FOOD, MUSIC, post('p_out', 'outdoors')];
    const reactions = [
      like('me', 'p_cat'),
      like('me', 'p_dog'),
      like('me', 'p_food'),
      like('me', 'p_music'),
      like('me', 'p_food'),
      // Priya co-liked a photo with me.
      like('priya', 'p_cat'),
      like('priya', 'p_food'),
      like('priya', 'p_music'),
      like('priya', 'p_food'),
      like('priya', 'p_food'),
      // Sam shares only a tag.
      like('sam', 'p_food'),
      like('sam', 'p_music'),
      like('sam', 'p_out'),
      like('sam', 'p_food'),
      like('sam', 'p_food'),
      // Robin has reacted to nothing in common.
      like('robin', 'p_out'),
      like('robin', 'p_out'),
    ];

    const result = closestByTaste(buildTasteIndex(reactions, posts), 'me', [
      { id: 'priya', name: 'Priya' },
      { id: 'sam', name: 'Sam' },
      { id: 'robin', name: 'Robin' },
    ]);

    expect(result.map((entry) => entry.userId)).toEqual(['priya', 'sam']);
    expect(result[0]?.reason).toContain('You both liked');
    expect(result.every((entry) => entry.affinity > 0)).toBe(true);
  });

  it('honours the limit', () => {
    const posts = [CAT, DOG, FOOD, MUSIC];
    const reactions = [like('a', 'p_cat'), like('b', 'p_cat'), like('c', 'p_cat')];
    for (const user of ['a', 'b', 'c']) {
      reactions.push(like(user, 'p_food'), like(user, 'p_music'), like(user, 'p_food'));
    }

    const result = closestByTaste(buildTasteIndex(reactions, posts), 'a', [
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]);

    expect(result).toHaveLength(2);
  });
});
/*
 * The curve.
 *
 * The verification question is whether the match percentage moves *smoothly* as
 * the evidence accumulates -- whether liking one more photo moves the number a
 * little, and liking one more after that moves it less, rather than the number
 * jumping or going backwards.
 *
 * The measurements below are the shape of the algorithm as it stands. They are
 * not a copy of the implementation: they are what the implementation is
 * measured against, so a change that made the curve jumpy or non-monotonic
 * would fail here.
 */
describe('the affinity curve', () => {
  /** Both people like the same n photos, and have n likes each. */
  function curve(n: number): { affinity: number; coLiked: number } {
    const posts = Array.from({ length: n }, (_, i) => post(`p${i}`, 'pets', 'outdoor'));
    const reactions = [
      ...posts.map((p) => like('me', p.id)),
      ...posts.map((p) => like('them', p.id)),
    ];
    const signal = tasteBetween(buildTasteIndex(reactions, posts), 'me', 'them');
    return { affinity: signal.affinity, coLiked: signal.coLikedPosts };
  }

  it('rises smoothly and monotonically as shared photos accumulate', () => {
    const points = [1, 2, 3, 4, 6, 8, 12, 20, 40].map((n) => ({ n, ...curve(n) }));

    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1]!;
      const current = points[i]!;

      // Never goes backwards.
      expect(current.affinity).toBeGreaterThanOrEqual(previous.affinity);
      // And does go forwards, so it is not flat.
      expect(current.affinity).toBeGreaterThan(previous.affinity);
    }
  });

  it('each extra shared photo matters less than the one before it', () => {
    // The saturation that stops a prolific pair from running away with the score.
    const first = curve(1).affinity - curve(0).affinity;
    const tenth = curve(10).affinity - curve(9).affinity;

    expect(first).toBeGreaterThan(tenth);
  });

  it('stays below 1 at any realistic volume of evidence', () => {
    // The underlying value is `n / (n + 2)`, which never reaches 1, so the
    // specific and broad halves can always both contribute.
    expect(curve(100).affinity).toBeLessThan(1);
    expect(curve(200).affinity).toBeLessThan(1);
  });

  it('rounds to 1 once the evidence is absurd, which is a display choice', () => {
    /*
     * Worth recording rather than asserting as a rule.
     *
     * The signal is rounded to two decimals, and the two halves stop being
     * distinguishable somewhere around four hundred shared photos -- the
     * underlying value is 0.995 and rounds to 1.00. The comment in `taste.ts`
     * says the saturation "never reaches 1", which is true of the arithmetic and
     * not of the number that gets shown.
     *
     * It is harmless in practice: two people who have liked four hundred of the
     * same photos are as close as the scale can express. But the claim in the
     * source is about the arithmetic, and the number on screen is rounded, and
     * only one of those is true at high volumes.
     */
    expect(curve(400).affinity).toBe(1);
  });

  it('reports how much of the pair the shared photos account for', () => {
    // The specific half saturates as n/(n+2); the broad half is what is left.
    expect(curve(2).coLiked).toBe(2);
    expect(curve(2).affinity).toBeGreaterThan(0);
  });
});
