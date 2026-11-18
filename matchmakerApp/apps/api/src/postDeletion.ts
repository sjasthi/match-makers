import type { PoolClient } from 'pg';
import { rebuildAffinityForUsers } from './affinity';

export interface PostDeletionResult {
  deleted: boolean;
  /** Users whose taste changed because they reacted to this post. */
  affectedUserIds: string[];
}

/**
 * Deletes a post and rebuilds taste data for everyone whose reaction cascaded
 * with it. Call inside a transaction; the caller must refresh both directions
 * of pairs involving `affectedUserIds` before committing.
 *
 * User rows are locked before the post so this follows the same lock order as
 * the reaction endpoint (user, then post/reaction) and no reaction can race the
 * rebuild. The post is checked once before locking users to make a repeated
 * delete a cheap no-op, then locked and checked again for concurrent deletes.
 */
export async function deletePostAndRebuildTaste(
  client: PoolClient,
  postId: string
): Promise<PostDeletionResult> {
  const exists = await client.query<{ id: string }>('SELECT id FROM posts WHERE id = $1', [postId]);
  if (!exists.rows[0]) return { deleted: false, affectedUserIds: [] };

  await client.query('SELECT id FROM users ORDER BY id FOR UPDATE');
  const lockedPost = await client.query<{ id: string }>(
    'SELECT id FROM posts WHERE id = $1 FOR UPDATE',
    [postId]
  );
  if (!lockedPost.rows[0]) return { deleted: false, affectedUserIds: [] };

  const { rows: reactors } = await client.query<{ user_id: string }>(
    'SELECT DISTINCT user_id FROM post_reactions WHERE post_id = $1 ORDER BY user_id',
    [postId]
  );
  const affectedUserIds = reactors.map((row) => row.user_id);

  const deleted = await client.query('DELETE FROM posts WHERE id = $1', [postId]);
  if ((deleted.rowCount ?? 0) === 0) {
    return { deleted: false, affectedUserIds: [] };
  }

  // The FK cascade has removed the post's reactions. Rebuild from what remains,
  // including clearing tags and summaries that no longer have any evidence.
  await rebuildAffinityForUsers(client, affectedUserIds);

  return { deleted: true, affectedUserIds };
}
