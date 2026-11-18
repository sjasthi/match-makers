import type { Queryable } from '@/db';

/**
 * The tag-weight vector: writing it, decaying it, and reading it back.
 *
 * One row per person per tag in `user_tag_affinity`, written the moment a photo
 * reaction lands. Before this existed the vector was derived in the client from
 * the whole reactions table on every read -- correct, but invisible to the
 * server, which therefore could not rank by it and ordered the deck by
 * registration date instead.
 */

/**
 * How long a like keeps most of its weight.
 *
 * Thirty days: long enough that a weekend away does not reset somebody's taste,
 * short enough that what they liked six months ago is not what they are shown
 * today. The checklist asks for "exponential decay ... so recent likes carry
 * higher weight"; a half-life is that, expressed as the number a person could
 * reason about.
 */
export const HALF_LIFE_DAYS = 30;

/** The half-life in seconds, which is what `extract(epoch ...)` produces. */
export const HALF_LIFE_SECONDS = HALF_LIFE_DAYS * 24 * 60 * 60;

/**
 * How much of a like's weight survives a given age.
 *
 * `exp(-age * ln(2) / half_life)`: full weight when fresh, exactly half at one
 * half-life, a quarter at two.
 *
 * The `ln(2)` is what makes it a half-life rather than an e-folding. Plain
 * `exp(-age / half_life)` reaches 1/e -- about 37% -- at the stated half-life,
 * so the decay was a good deal weaker than the name said. A unit test caught it
 * by asserting the value at exactly one half-life.
 *
 * Pure and exported so the decay is testable without a database, and so the SQL
 * below and any reader provably agree -- the same expression appears in both,
 * and this one is the reference.
 */
export function decayFactor(ageSeconds: number): number {
  return Math.exp((-ageSeconds * Math.LN2) / HALF_LIFE_SECONDS);
}

/**
 * The decayed weight of one tag, as the ranking uses it.
 *
 * The raw net approval (`likes - dislikes`) scaled by how long ago the person
 * last touched the tag. Negative when they have pushed the tag away, so the
 * ranking can skip it exactly the way the client's `score <= 0` check does.
 */
export function effectiveWeight(row: {
  likes: number;
  dislikes: number;
  lastActivityAt: Date;
  now?: Date;
}): number {
  const now = row.now ?? new Date();
  const age = Math.max(0, (now.getTime() - row.lastActivityAt.getTime()) / 1000);
  return (row.likes - row.dislikes) * decayFactor(age);
}

/**
 * Folds a reaction into one person's vector.
 *
 * `undo` is the mirror of apply, because the feed takes a reaction back by
 * deleting the row, and the vector has to move back with it or the two would
 * disagree about what the person likes.
 *
 * Two statements rather than one parameterised one, because they differ in more
 * than a sign: applying touches `last_activity_at` -- a new reaction is new
 * evidence -- and taking one back deliberately does not, so that toggling a
 * like cannot keep an old opinion fresh forever.
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
      // reaction back is not new evidence, and refreshing it would let somebody
      // keep an old opinion fresh by toggling.
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
 * The decayed positive strength of one tag, in SQL.
 *
 * Mirrors `effectiveWeight` and then applies the same Laplace-style prior the
 * client uses, so one recent like reads as weak evidence (about 0.5) rather
 * than as certainty, and a stale one reads as weaker still:
 *
 *     strength = effective / (effective + 1)
 *
 * Only positive net approval counts -- `likes > dislikes` -- which is the same
 * gate as the client's `score <= 0` skip. A tag one of the pair has pushed away
 * is not shared ground.
 *
 * Interpolated into the ranking query rather than bound, because a `$n`
 * placeholder cannot hold an expression. It contains no user input.
 */
export const TAG_STRENGTH_SQL = `
  CASE
    WHEN a.likes > a.dislikes THEN
      ((a.likes - a.dislikes)
        * exp(- extract(epoch FROM (now() - a.last_activity_at)) * ln(2) / ${HALF_LIFE_SECONDS}))
      / ((a.likes - a.dislikes)
        * exp(- extract(epoch FROM (now() - a.last_activity_at)) * ln(2) / ${HALF_LIFE_SECONDS}) + 1)
    ELSE 0
  END`;
