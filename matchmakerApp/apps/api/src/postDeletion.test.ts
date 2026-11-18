import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withTransaction } from './db';
import { rebuildAffinityForUsers } from './affinity';
import { rescoreForViewer } from './matching';
import { deletePostAndRebuildTaste } from './postDeletion';

let available = false;
const createdUsers: string[] = [];
const createdPosts: string[] = [];

const TEST_ELIGIBILITY = `
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
  if (!id) throw new Error('could not create the post-deletion test user');
  createdUsers.push(id);
  return id;
}

async function makePost(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO posts (image_uri, tags) VALUES ('test://delete-post', ARRAY['pets']) RETURNING id`
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('could not create the post-deletion test post');
  createdPosts.push(id);
  return id;
}

async function like(userId: string, postId: string): Promise<void> {
  await pool.query(
    `INSERT INTO post_reactions (user_id, post_id, action)
     VALUES ($1, $2, 'like')
     ON CONFLICT (user_id, post_id) DO UPDATE SET action = 'like'`,
    [userId, postId]
  );
}

async function scoreFor(
  viewerId: string,
  candidateId: string
): Promise<{ score: number; affinity: number; coLiked: number }> {
  const { rows } = await pool.query<{
    score: number;
    taste_affinity: string;
    co_liked_count: number;
  }>(
    `SELECT score, taste_affinity, co_liked_count
       FROM match_scores
      WHERE viewer_id = $1 AND candidate_id = $2`,
    [viewerId, candidateId]
  );
  const row = rows[0];
  if (!row) throw new Error('no score was stored for the test pair');
  return {
    score: row.score,
    affinity: Number(row.taste_affinity),
    coLiked: row.co_liked_count,
  };
}

describe('deleting a liked photo post', () => {
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

  test('removes reactions, rebuilds taste, and lowers cached scores', async (t) => {
    if (!available) {
      t.skip('no database available');
      return;
    }

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const viewerId = await makeUser(`post-delete-viewer-${suffix}@test.local`);
    const candidateId = await makeUser(`post-delete-candidate-${suffix}@test.local`);
    const firstPost = await makePost();
    const secondPost = await makePost();

    for (const postId of [firstPost, secondPost]) {
      await like(viewerId, postId);
      await like(candidateId, postId);
    }

    await withTransaction(async (client) => {
      await rebuildAffinityForUsers(client, [viewerId, candidateId]);
      await rescoreForViewer(client, viewerId, TEST_ELIGIBILITY);
    });
    const before = await scoreFor(viewerId, candidateId);
    assert.equal(before.coLiked, 2);

    const deletion = await withTransaction(async (client) => {
      const result = await deletePostAndRebuildTaste(client, firstPost);
      if (result.deleted) await rescoreForViewer(client, viewerId, TEST_ELIGIBILITY);
      return result;
    });

    assert.equal(deletion.deleted, true);
    assert.deepEqual(new Set(deletion.affectedUserIds), new Set([viewerId, candidateId]));
    const { rows: deletedReactions } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM post_reactions WHERE post_id = $1',
      [firstPost]
    );
    assert.equal(Number(deletedReactions[0]?.count ?? 0), 0);

    const afterOneDeletion = await scoreFor(viewerId, candidateId);
    assert.equal(afterOneDeletion.coLiked, 1);
    assert.ok(afterOneDeletion.score < before.score);
    assert.ok(afterOneDeletion.affinity < before.affinity);

    await withTransaction(async (client) => {
      const result = await deletePostAndRebuildTaste(client, secondPost);
      if (result.deleted) await rescoreForViewer(client, viewerId, TEST_ELIGIBILITY);
    });

    const noTaste = await scoreFor(viewerId, candidateId);
    assert.equal(noTaste.score, 0);
    assert.equal(noTaste.affinity, 0);
    assert.equal(noTaste.coLiked, 0);

    const { rows: summary } = await pool.query<{ likes: number; positive_tags: number }>(
      'SELECT likes, positive_tags FROM user_taste_summary WHERE user_id = $1',
      [viewerId]
    );
    assert.deepEqual(summary[0], { likes: 0, positive_tags: 0 });

    const { rows: vectors } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM user_tag_affinity WHERE user_id = $1',
      [viewerId]
    );
    assert.equal(Number(vectors[0]?.count ?? 0), 0);
  });
});
