import type { Queryable } from '@/db';

/**
 * The tag-weight vector: writing it and reading it back.
 *
 * One row per person per tag in `user_tag_affinity`, written the moment a photo
 * reaction lands. Before this existed the vector was derived in the client from
 * the whole reactions table on every read -- correct, but invisible to the
 * server, which therefore could not rank by it and ordered the deck by
 * registration date instead.
 */

/**
 * Folds a reaction into one person's vector.
 *
 * `undo` is the mirror of apply, because the feed takes a reaction back by
 * deleting the row, and the vector has to move back with it or the two would
 * disagree about what the person likes.
 *
 * Two statements rather than one parameterised one, because applying records
 * the latest activity while taking a reaction back does not count as new
 * activity. `last_activity_at` is metadata only; it does not affect scoring.
 */
export async function applyReactionToAffinity(
  client: Queryable,
  userId: string,
  tags: readonly string[],
  action: 'like' | 'dislike',
  options: { undo?: boolean } = {}
): Promise<void> {
  if (tags.length === 0) return;

  const column = action === 'like' ? 'likes' : 'dislikes';
  const other = action === 'like' ? 'dislikes' : 'likes';

  for (const tag of tags) {
    if (options.undo) {
      // Remove the row outright when this would empty it, so a zeroed opinion
      // does not linger as a row something counts. Checked before the
      // decrement, because afterwards it is too late to know.
      await client.query(
        `DELETE FROM user_tag_affinity
          WHERE user_id = $1 AND tag = $2
            AND ${column} <= 1
            AND ${other} = 0`,
        [userId, tag]
      );

      // Otherwise count the tag out, leaving `last_activity_at` alone: taking a
      // reaction back is not new activity.
      await client.query(
        `UPDATE user_tag_affinity
            SET ${column} = ${column} - 1
          WHERE user_id = $1 AND tag = $2`,
        [userId, tag]
      );
      continue;
    }

    await client.query(
      `INSERT INTO user_tag_affinity (user_id, tag, ${column}, last_activity_at)
            VALUES ($1, $2, 1, now())
       ON CONFLICT (user_id, tag) DO UPDATE SET
            ${column} = user_tag_affinity.${column} + 1,
            last_activity_at = now()`,
      [userId, tag]
    );
  }

  /*
   * The per-user summary, recomputed from the vector after the change.
   *
   * Not incrementally maintained, deliberately. An increment would have to
   * detect a tag crossing zero in both directions, inside a loop, in SQL -- and
   * any mistake there is invisible until the ranking disagrees with the truth.
   * Recomputing reads one person's vector through the primary key's leading
   * column, which is a couple of hundred rows, and the answer is correct by
   * construction. The write path touches one person at a time, so this is the
   * cheap end of that trade.
   */
  await client.query(
    `INSERT INTO user_taste_summary (user_id, positive_tags, likes)
     SELECT $1,
            count(*) FILTER (WHERE a.likes > a.dislikes),
            (SELECT count(*) FROM post_reactions WHERE user_id = $1 AND action = 'like')
       FROM user_tag_affinity a
      WHERE a.user_id = $1
     ON CONFLICT (user_id) DO UPDATE SET
            positive_tags = EXCLUDED.positive_tags,
            likes = EXCLUDED.likes`,
    [userId]
  );
}

/**
 * Rebuilds the taste vectors and summaries for a set of users from their
 * remaining reactions.
 *
 * Replacing the rows, rather than only upserting the aggregates, is important
 * when a post is deleted: its reactions cascade away, and tags that no longer
 * have any reactions must disappear from the vector too.
 */
export async function rebuildAffinityForUsers(
  client: Queryable,
  userIds: readonly string[]
): Promise<number> {
  if (userIds.length === 0) return 0;

  await client.query('DELETE FROM user_tag_affinity WHERE user_id = ANY($1::uuid[])', [userIds]);

  const { rowCount } = await client.query(
    `INSERT INTO user_tag_affinity (user_id, tag, likes, dislikes, last_activity_at)
     SELECT r.user_id,
            tag,
            count(*) FILTER (WHERE r.action = 'like')::integer,
            count(*) FILTER (WHERE r.action = 'dislike')::integer,
            max(r.created_at)
       FROM post_reactions r
       JOIN posts p ON p.id = r.post_id
       CROSS JOIN LATERAL unnest(p.tags) AS tag
      WHERE r.user_id = ANY($1::uuid[])
      GROUP BY r.user_id, tag
      ON CONFLICT (user_id, tag) DO UPDATE SET
        likes = EXCLUDED.likes,
        dislikes = EXCLUDED.dislikes,
        last_activity_at = EXCLUDED.last_activity_at`,
    [userIds]
  );

  // Rebuild even users who now have no likes, so stale positive counts become 0.
  await client.query(
    `INSERT INTO user_taste_summary (user_id, positive_tags, likes)
     SELECT affected.user_id,
            (SELECT count(*)
               FROM user_tag_affinity a
              WHERE a.user_id = affected.user_id AND a.likes > a.dislikes)::integer,
            (SELECT count(*)
               FROM post_reactions r
              WHERE r.user_id = affected.user_id AND r.action = 'like')::integer
       FROM unnest($1::uuid[]) AS affected(user_id)
     ON CONFLICT (user_id) DO UPDATE SET
       positive_tags = EXCLUDED.positive_tags,
       likes = EXCLUDED.likes`,
    [userIds]
  );

  return rowCount ?? 0;
}

/** Rebuilds every stored taste vector, including users whose vectors are now empty. */
export async function backfillAffinity(client: Queryable): Promise<number> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM users ORDER BY id');
  return rebuildAffinityForUsers(
    client,
    rows.map((row) => row.id)
  );
}

/**
 * The weight of one tag, in SQL.
 *
 * Raw net approval scaled by how rare the tag is in the photo library:
 *
 *     strength = (likes - dislikes) * ln(1 + total photos / photos with the tag)
 *
 * Two choices here are load-bearing:
 *
 * - **No smoothing.** An earlier version divided by `(net + 1)` so a small
 *   count would not read as certainty, but cosine already bounds the pair
 *   result by itself, so the division never bounded anything -- it only
 *   flattened the honest gap between a tag liked once and a tag liked six
 *   times. The confidence term in the ranking is the one deliberate damper
 *   for thin evidence; a second one is an accident.
 * - **The rarity multiplier.** Without it, a library dominated by one subject
 *   makes everybody's vector dominated by that subject, and the "similarity"
 *   measures the library's composition rather than the pair's taste. A tag
 *   few photos carry is stronger evidence than a tag the library is full of.
 *   The multiplier is a property of the tag, not of either person, so the
 *   pair score stays symmetric.
 *
 * Only positive net approval counts -- `likes > dislikes` -- which is the same
 * gate as the client's `score <= 0` skip. A tag one of the pair has pushed away
 * is not shared ground.
 *
 * Expects three aliases in scope wherever it is interpolated: `a` (the
 * `user_tag_affinity` row), `d` (the matching `tag_docs` row) and `l` (the
 * single-row `library` CTE). The joins are the caller's half of that contract;
 * `rankingCtes` in `matching.ts` is the reference implementation. An inner
 * join drops a tag the library no longer carries, deliberately: such a tag can
 * produce no future co-likes, and its rarity is undefined.
 *
 * Interpolated into the ranking query rather than bound, because a `$n`
 * placeholder cannot hold an expression. It contains no user input.
 */
export const TAG_STRENGTH_SQL = `
  CASE
    WHEN a.likes > a.dislikes THEN
      (a.likes - a.dislikes)::float8 * ln(1 + l.p::float8 / d.docs)
    ELSE 0
  END`;
