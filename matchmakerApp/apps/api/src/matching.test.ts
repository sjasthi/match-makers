import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, type Queryable } from './db';
import { admitsToDeck, DECK_ENTER_SCORE, rescoreForViewer } from './matching';

/**
 * The ranking, tested against the database.
 *
 * The scoring is SQL, so a test that only checks a JavaScript function proves
 * nothing about what the server actually does. These run the real rescore over
 * real rows and read the stored result back.
 *
 * The users, posts and reactions are created here and deleted afterwards, so
 * the test leaves nothing behind and does not depend on the library having any
 * content in it.
 *
 * Skipped when there is no database to talk to, because "the test could not
 * check anything" should not be reported as "the test passed".
 */

/**
 * Whether there is a database to talk to.
 *
 * Checked in a `before` hook rather than at the top level, because the module
 * is compiled to CommonJS and top-level await is not available there. A test
 * that could not check anything is *skipped*, not passed: "the test could not
 * run" and "the test passed" are different claims.
 */
let available = false;

/** Everybody the test creates, so it can remove all of them afterwards. */
const createdUsers: string[] = [];
const createdPosts: string[] = [];

/**
 * A gate that does not filter, so the test measures the scoring and nothing
 * else.
 *
 * Restricted to the test's own accounts. The rescore writes a row for every
 * candidate the gate admits, so a gate that admitted everybody would leave
 * score rows for the real accounts behind -- the test would be changing the
 * data it is supposed to be measured against, and the next rescore would
 * quietly overwrite them.
 */
const ELIGIBILITY = `
  SELECT u.id, u.relationship_goal, u.sexual_orientation, u.is_verified, u.created_at
    FROM users u
   WHERE u.id <> $1
     AND u.email LIKE '%@test.local'
`;

async function makeUser(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, date_of_birth, gender)
          VALUES ($1, 'test', $2, '1993-05-05', 'female')
       RETURNING id`,
    [email, email]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('could not create a test user');
  createdUsers.push(id);
  return id;
}

async function makePost(tags: string[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO posts (image_uri, tags) VALUES ('test://photo', $1) RETURNING id`,
    [tags]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('could not create a test post');
  createdPosts.push(id);
  return id;
}

async function like(userId: string, postId: string): Promise<void> {
  await pool.query(
    `INSERT INTO post_reactions (user_id, post_id, action) VALUES ($1, $2, 'like')
     ON CONFLICT (user_id, post_id) DO UPDATE SET action = 'like'`,
    [userId, postId]
  );
}

async function likeAt(userId: string, postId: string, createdAt: string): Promise<void> {
  await pool.query(
    `INSERT INTO post_reactions (user_id, post_id, action, created_at)
     VALUES ($1, $2, 'like', $3)
     ON CONFLICT (user_id, post_id)
     DO UPDATE SET action = 'like', created_at = EXCLUDED.created_at`,
    [userId, postId, createdAt]
  );
}

/** The stored score for one pair, and the numbers behind it. */
async function scoreFor(
  viewerId: string,
  candidateId: string
): Promise<{ score: number; affinity: number; coLiked: number; band: string }> {
  const { rows } = await pool.query<{
    score: number;
    taste_affinity: string;
    co_liked_count: number;
    band: string;
  }>(
    `SELECT score, taste_affinity, co_liked_count, band
       FROM match_scores
      WHERE viewer_id = $1 AND candidate_id = $2`,
    [viewerId, candidateId]
  );
  const row = rows[0];
  if (!row) throw new Error('no score was stored for the pair');
  return {
    score: row.score,
    affinity: Number(row.taste_affinity),
    coLiked: row.co_liked_count,
    band: row.band,
  };
}

/** When the pair was first revealed to this viewer's deck, if it ever was. */
async function revealFor(viewerId: string, candidateId: string): Promise<Date | null> {
  const { rows } = await pool.query<{ revealed_at: Date | null }>(
    `SELECT revealed_at
       FROM match_scores
      WHERE viewer_id = $1 AND candidate_id = $2`,
    [viewerId, candidateId]
  );
  return rows[0]?.revealed_at ?? null;
}

/** Rebuilds the vectors for the test users, as a reaction would have. */
async function rebuildVectors(client: Queryable): Promise<void> {
  await client.query(
    `DELETE FROM user_tag_affinity
      WHERE user_id = ANY($1::uuid[])`,
    [createdUsers]
  );

  for (const userId of createdUsers) {
    const { rows } = await pool.query<{ post_id: string; tags: string[] }>(
      `SELECT r.post_id, p.tags
         FROM post_reactions r
         JOIN posts p ON p.id = r.post_id
        WHERE r.user_id = $1 AND r.action = 'like'`,
      [userId]
    );

    for (const row of rows) {
      for (const tag of row.tags) {
        await client.query(
          `INSERT INTO user_tag_affinity (user_id, tag, likes)
                VALUES ($1, $2, 1)
           ON CONFLICT (user_id, tag)
             DO UPDATE SET likes = user_tag_affinity.likes + 1,
                           last_activity_at = now()`,
          [userId, tag]
        );
      }
    }

    /*
     * The summary table as well.
     *
     * The write path maintains it alongside the vector, and the ranking reads
     * the viewer's like count from it to damp the signal for people who have
     * not answered much. Leaving it empty would make every pair score zero --
     * not because they do not match, but because the test did not set up the
     * table the real write path would have filled in.
     */
    await client.query(
      `INSERT INTO user_taste_summary (user_id, positive_tags, likes)
            SELECT a.user_id,
                   count(*) FILTER (WHERE a.likes > a.dislikes),
                   (SELECT count(*) FROM post_reactions r
                     WHERE r.user_id = a.user_id AND r.action = 'like')
              FROM user_tag_affinity a
             WHERE a.user_id = ANY($1::uuid[])
             GROUP BY a.user_id
       ON CONFLICT (user_id) DO UPDATE
              SET positive_tags = EXCLUDED.positive_tags,
                  likes = EXCLUDED.likes`,
      [createdUsers]
    );
  }
}

test('deck admission is hysteretic', () => {
  const revealed = new Date('2026-01-01T00:00:00.000Z');

  assert.equal(admitsToDeck(80, null), true, 'the entry bar alone admits');
  assert.equal(admitsToDeck(79, null), false, 'below the bar, never revealed');
  assert.equal(admitsToDeck(79, revealed), true, 'a revealed pair stays above the exit floor');
  assert.equal(admitsToDeck(75, revealed), true, 'the exit floor is inclusive');
  assert.equal(admitsToDeck(74, revealed), false, 'a real fall leaves the deck');
  assert.equal(admitsToDeck(null, revealed), false, 'no score is never in the deck');
});

describe('the ranking, against the database', () => {
  before(async () => {
    try {
      await pool.query('SELECT 1');
      available = true;
    } catch {
      available = false;
    }
  });

  after(async () => {
    if (createdUsers.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUsers]);
    }
    if (createdPosts.length > 0) {
      await pool.query('DELETE FROM posts WHERE id = ANY($1::uuid[])', [createdPosts]);
    }
    await pool.end();
  });

  test('two people with the same taste score higher than two who share a little', async (t) => {
    if (!available) {
      t.skip('no database available');
      return;
    }

    const viewer = await makeUser('cosine-viewer@test.local');
    const twin = await makeUser('cosine-twin@test.local');
    const neighbour = await makeUser('cosine-neighbour@test.local');
    const stranger = await makeUser('cosine-stranger@test.local');

    // Two photos about cats, two about dogs, two about food.
    const cats = await makePost(['cats', 'pets']);
    const cats2 = await makePost(['cats', 'animals']);
    const dogs = await makePost(['dogs', 'pets']);
    const dogs2 = await makePost(['dogs', 'animals']);
    const food = await makePost(['food', 'cooking']);
    const food2 = await makePost(['food', 'baking']);

    // The viewer likes everything.
    for (const post of [cats, cats2, dogs, dogs2, food, food2]) await like(viewer, post);

    // The twin likes exactly the same things.
    for (const post of [cats, cats2, dogs, dogs2, food, food2]) await like(twin, post);

    // The neighbour likes the same two cats, and nothing else the viewer likes.
    await like(neighbour, cats);
    await like(neighbour, cats2);

    // The stranger likes nothing the viewer has seen.
    const gardening = await makePost(['gardening', 'plants']);
    await like(stranger, gardening);

    await rebuildVectors(pool);
    await rescoreForViewer(pool, viewer, ELIGIBILITY);

    const twinScore = await scoreFor(viewer, twin);
    const neighbourScore = await scoreFor(viewer, neighbour);
    const strangerScore = await scoreFor(viewer, stranger);

    assert.ok(
      twinScore.affinity > neighbourScore.affinity,
      `twin (${twinScore.affinity}) should beat neighbour (${neighbourScore.affinity})`
    );
    assert.ok(
      neighbourScore.affinity > strangerScore.affinity,
      `neighbour (${neighbourScore.affinity}) should beat stranger (${strangerScore.affinity})`
    );
    assert.equal(strangerScore.affinity, 0, 'a pair with nothing shared scores zero');
  });

  test('stores one symmetric score in both directions despite different like times', async (t) => {
    if (!available) {
      t.skip('no database available');
      return;
    }

    const earlier = await makeUser('symmetric-earlier@test.local');
    const later = await makeUser('symmetric-later@test.local');
    const sharedPosts = await Promise.all(
      Array.from({ length: 5 }, () => makePost(['shared-interest']))
    );
    const earlierLike = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const laterLike = new Date(Date.now() - 1000).toISOString();

    for (const postId of sharedPosts) {
      await likeAt(earlier, postId, earlierLike);
      await likeAt(later, postId, laterLike);
    }

    await rebuildVectors(pool);
    await rescoreForViewer(pool, earlier, ELIGIBILITY);

    const fromEarlier = await scoreFor(earlier, later);
    const fromLater = await scoreFor(later, earlier);
    assert.deepEqual(fromEarlier, fromLater);

    // Recomputing from the reverse viewer must not change the pair's score.
    await rescoreForViewer(pool, later, ELIGIBILITY);
    assert.deepEqual(await scoreFor(earlier, later), fromEarlier);
    assert.deepEqual(await scoreFor(later, earlier), fromEarlier);
  });

  test('reaction timestamps do not change the score', async (t) => {
    if (!available) {
      t.skip('no database available');
      return;
    }

    const oldViewer = await makeUser('stable-old-viewer@test.local');
    const oldPartner = await makeUser('stable-old-partner@test.local');
    const recentViewer = await makeUser('stable-recent-viewer@test.local');
    const recentPartner = await makeUser('stable-recent-partner@test.local');

    const oldPosts = await Promise.all(
      Array.from({ length: 5 }, () => makePost(['stable-interest']))
    );
    const recentPosts = await Promise.all(
      Array.from({ length: 5 }, () => makePost(['stable-interest']))
    );
    const oldLike = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const recentLike = new Date(Date.now() - 1000).toISOString();

    for (const postId of oldPosts) {
      await likeAt(oldViewer, postId, oldLike);
      await likeAt(oldPartner, postId, oldLike);
    }
    for (const postId of recentPosts) {
      await likeAt(recentViewer, postId, recentLike);
      await likeAt(recentPartner, postId, recentLike);
    }

    await rebuildVectors(pool);
    // The production rebuild uses reaction timestamps for this metadata. Set
    // the test vectors explicitly so the test detects any accidental use of age.
    await pool.query(
      `UPDATE user_tag_affinity
          SET last_activity_at = $2
        WHERE user_id = ANY($1::uuid[])`,
      [[oldViewer, oldPartner], oldLike]
    );

    await rescoreForViewer(pool, oldViewer, ELIGIBILITY);
    await rescoreForViewer(pool, recentViewer, ELIGIBILITY);

    assert.deepEqual(
      await scoreFor(oldViewer, oldPartner),
      await scoreFor(recentViewer, recentPartner)
    );
  });

  test('the tag half is a cosine, so a broad taste does not equal a narrow one', async (t) => {
    if (!available) {
      t.skip('no database available');
      return;
    }

    const viewer = await makeUser('cosine-broad@test.local');
    const narrow = await makeUser('cosine-narrow@test.local');
    const identical = await makeUser('cosine-identical@test.local');

    // The viewer has a broad taste: six different subjects.
    const broad: string[] = [
      await makePost(['cats']),
      await makePost(['dogs']),
      await makePost(['food']),
      await makePost(['music']),
      await makePost(['travel']),
      await makePost(['sport']),
    ];
    for (const post of broad) await like(viewer, post);

    // The narrow one has two opinions, and both of them are the viewer's.
    const [first, second] = broad;
    assert.ok(first && second, 'the fixture should have at least two posts');
    await like(narrow, first);
    await like(narrow, second);

    // The identical one has all six, like the viewer.
    for (const post of broad) await like(identical, post);

    await rebuildVectors(pool);
    await rescoreForViewer(pool, viewer, ELIGIBILITY);

    const narrowScore = await scoreFor(viewer, narrow);
    const identicalScore = await scoreFor(viewer, identical);

    assert.ok(
      identicalScore.affinity > narrowScore.affinity,
      `identical (${identicalScore.affinity}) should beat narrow (${narrowScore.affinity})`
    );

    /*
     * The cosine is what makes the second assertion true.
     *
     * The narrow person's two tags are both the viewer's, so the shared weight
     * is the same as it would be against somebody with those same two tags and
     * nothing else. What separates them is the denominator: the viewer's vector
     * is six long, so a two-tag vector does not line up with it as squarely as
     * a six-tag one does.
     */
    assert.ok(
      narrowScore.affinity < 1,
      `a narrow taste inside a broad one should not score a perfect match (${narrowScore.affinity})`
    );
  });

  test('the score rises smoothly as the shared evidence accumulates', async (t) => {
    if (!available) {
      t.skip('no database available');
      return;
    }

    const viewer = await makeUser('cosine-curve@test.local');
    const partner = await makeUser('cosine-curve-partner@test.local');

    const posts = [
      await makePost(['cats', 'pets']),
      await makePost(['dogs', 'pets']),
      await makePost(['food', 'cooking']),
      await makePost(['music', 'bands']),
      await makePost(['travel', 'cities']),
    ];

    const scores: number[] = [];

    for (const post of posts) {
      await like(viewer, post);
      await like(partner, post);
      await rebuildVectors(pool);
      await rescoreForViewer(pool, viewer, ELIGIBILITY);
      scores.push((await scoreFor(viewer, partner)).score);
    }

    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(
        (scores[i] ?? 0) >= (scores[i - 1] ?? 0),
        `the score should not fall: ${scores.join(', ')}`
      );
    }

    // And it should not jump: the biggest single step is a fraction of the
    // whole range, rather than the whole thing appearing at once.
    const steps = scores.slice(1).map((value, index) => value - (scores[index] ?? 0));
    const biggest = Math.max(...steps);
    assert.ok(biggest <= 40, `no single step should be huge: ${scores.join(', ')}`);

    assert.ok(
      (scores[scores.length - 1] ?? 0) > (scores[0] ?? 0),
      `more shared photos should mean a higher score: ${scores.join(', ')}`
    );
  });

  test('the band follows the score', async (t) => {
    if (!available) {
      t.skip('no database available');
      return;
    }

    const viewer = await makeUser('cosine-band@test.local');
    const partner = await makeUser('cosine-band-partner@test.local');

    const posts = [
      await makePost(['cats', 'pets']),
      await makePost(['dogs', 'pets']),
      await makePost(['food', 'cooking']),
      await makePost(['music', 'bands']),
    ];
    for (const post of posts) {
      await like(viewer, post);
      await like(partner, post);
    }

    await rebuildVectors(pool);
    await rescoreForViewer(pool, viewer, ELIGIBILITY);

    const stored = await scoreFor(viewer, partner);
    const expected =
      stored.score >= 90
        ? '90+'
        : stored.score >= 75
          ? '75+'
          : stored.score >= 50
            ? '50+'
            : 'below-50';

    assert.equal(stored.band, expected);
  });

  test('a pair that reaches the deck is revealed once, and the reveal survives rescoring', async (t) => {
    if (!available) {
      t.skip('no database available');
      return;
    }

    const viewer = await makeUser('deck-viewer@test.local');
    const partner = await makeUser('deck-partner@test.local');
    const control = await makeUser('deck-control@test.local');

    // Five photos the pair both like. Their vectors are identical, so the tag
    // cosine is exactly 1 and the shared-photo half carries them over the
    // deck's entry score whatever the library happens to look like.
    const shared = await Promise.all(
      Array.from({ length: 5 }, () => makePost(['deck-shared-interest']))
    );
    for (const post of shared) {
      await like(viewer, post);
      await like(partner, post);
    }

    // The control shares one photo: a real score, but nowhere near the deck.
    await like(control, shared[0] as string);

    await rebuildVectors(pool);
    await rescoreForViewer(pool, viewer, ELIGIBILITY);

    const before = await scoreFor(viewer, partner);
    assert.ok(
      before.score >= DECK_ENTER_SCORE,
      `the fixture should cross the entry score (got ${before.score})`
    );

    const revealedAt = await revealFor(viewer, partner);
    assert.ok(revealedAt, 'a pair over the entry score is revealed');
    assert.ok(await revealFor(partner, viewer), 'the reveal belongs to the pair, not one side');
    assert.equal(await revealFor(viewer, control), null, 'a pair that never crossed is not');
    assert.ok(
      (await scoreFor(viewer, control)).score < DECK_ENTER_SCORE,
      'the control really does sit below the bar'
    );

    /*
     * The viewer's taste broadens: three photos the partner has not liked.
     * The cosine falls and the pair drops below the entry score -- and the
     * reveal must survive the rescore that says so, because hysteresis is
     * only as durable as the marker it reads.
     */
    const solo = await Promise.all(
      Array.from({ length: 3 }, (_, i) => makePost([`deck-solo-${i}`]))
    );
    for (const post of solo) await like(viewer, post);

    await rebuildVectors(pool);
    await rescoreForViewer(pool, viewer, ELIGIBILITY);

    const after = await scoreFor(viewer, partner);
    assert.ok(after.score < before.score, 'broadening one side lowers the pair score');
    assert.ok(
      admitsToDeck(after.score, await revealFor(viewer, partner)),
      'a revealed pair above the exit floor stays in the deck'
    );
    assert.equal(
      (await revealFor(viewer, partner))?.getTime(),
      revealedAt?.getTime(),
      "the reveal is the pair's first crossing, not refreshed on every rescore"
    );
  });
});
