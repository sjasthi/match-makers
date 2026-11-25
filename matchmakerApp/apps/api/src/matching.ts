import { TAG_STRENGTH_SQL } from '@/affinity';
import type { Queryable } from '@/db';

/**
 * The server-side match ranking.
 *
 * The same algorithm the client has always run, moved into SQL so the server can
 * order the deck by it instead of by registration date. The constants below are
 * the client's, transcribed: the two shapes must not drift, because a deck
 * ordered one way and a card explaining itself another way is a lie with two
 * authors.
 *
 * A pair has one score, stored in both viewer/candidate directions. Reaction
 * timestamps do not affect the score, so the same reaction history produces
 * the same score whenever it is recomputed.
 *
 * The tag half of the taste signal is a **cosine similarity** between the two
 * people's tag-weight vectors -- the dot product over the tags they share,
 * divided by the length of each vector. It replaces an earlier normalisation
 * that divided the shared weight by the smaller of the two tag counts, which
 * said that somebody with two strong opinions and somebody with two hundred were
 * equally well matched on the two they had in common. Cosine is the standard
 * measure, it is bounded in [0, 1] without a clamp, and it prices a broad
 * taste against a narrow one honestly.
 *
 * A tag's weight inside those vectors is its net approval scaled by how rare
 * the tag is in the photo library -- see `TAG_STRENGTH_SQL`. The rarity is
 * what keeps the similarity measuring the pair's taste rather than the
 * library's composition as the library grows, and because it is a property of
 * the tag rather than of either person, the pair score stays symmetric.
 *
 * The ranking is computed by `rescoreForViewer` and stored in `match_scores`,
 * rather than being computed per request. The reason is cost, and it is not a
 * small one: the overlap join reads every candidate's row for every tag the
 * viewer leans towards, which measured at 569ms over 400,000 rows -- paid on
 * every feed request to answer a question that only changes when somebody
 * reacts.
 */

/** The client's `CO_LIKE_SATURATION`: co-like overlap is `n / (n + 2)`. */
const CO_LIKE_SATURATION = 2;

/** The client's split between specific and broad evidence. */
const CO_LIKE_SHARE = 0.65;
const TAG_SHARE = 0.35;

/** The client's `CONFIDENCE_MIN_LIKES`: below five likes each, the signal damps. */
const CONFIDENCE_MIN_LIKES = 5;

/** The client's `PHOTOS_FOR_FULL_TASTE`: below this the score is provisional. */
export const PHOTOS_FOR_FULL_TASTE = 10;

/** The client's `MATCH_WEIGHTS`, out of 100. */
export const MATCH_WEIGHTS = { taste: 100 } as const;

/**
 * The bands a match percentage falls into.
 *
 * 50 / 75 / 90, as the product spec asks. Named by their floor so a badge can
 * say what it means without a second lookup, and so a threshold change is a
 * change to this list rather than to three scattered comparisons.
 */
export const MATCH_BANDS = [
  { floor: 90, label: '90+' },
  { floor: 75, label: '75+' },
  { floor: 50, label: '50+' },
] as const;

/** Which band a score falls into. Pure, so the route and the tests share it. */
export function bandFor(score: number): string {
  for (const band of MATCH_BANDS) {
    if (score >= band.floor) return band.label;
  }
  return 'below-50';
}

/**
 * The band, as a SQL expression over an aliased `score` column.
 *
 * The searched form (`CASE WHEN ... THEN`) rather than the simple one
 * (`CASE x WHEN y THEN`): the simple form compares the operand to the `WHEN`
 * value, which here is a boolean expression, and Postgres rejects that outright
 * with "operator does not exist: double precision = boolean".
 */
function bandSql(scoreColumn: string): string {
  return `CASE
            WHEN ${scoreColumn} >= 90 THEN '90+'
            WHEN ${scoreColumn} >= 75 THEN '75+'
            WHEN ${scoreColumn} >= 50 THEN '50+'
            ELSE 'below-50'
          END`;
}

/**
 * The score a pair needs to enter the Likes deck.
 *
 * Kept here, next to the bands, so the entry bar, the exit floor and the badge
 * floors are all in one file. The feed interpolates this into its SQL rather
 * than calling a function, because the admission happens inside the query.
 */
export const DECK_ENTER_SCORE = 80;

/**
 * The floor a revealed pair must stay above to remain in the deck.
 *
 * Hysteresis: a pair that has already appeared in somebody's deck stays
 * visible until its score falls this far, so a percentage wobbling around the
 * entry bar -- after a rescore, a library import, or the pair's own new
 * reactions -- cannot silently remove a card somebody was already shown. Below
 * the exit floor the fall is real rather than noise, and the pair leaves.
 *
 * The gap to the entry score is the whole point: a pair bouncing between 79
 * and 81 flickers in and out of the deck with a single bar, and with two bars
 * it stays put until its evidence has genuinely collapsed.
 */
export const DECK_EXIT_SCORE = 75;

/**
 * Whether a pair belongs in the deck, given its score and reveal state.
 *
 * The readable restatement of the rule the feed query applies, so the tests can
 * pin it and a reader does not have to parse SQL to know what "in the deck"
 * means.
 */
export function admitsToDeck(score: number | null, revealedAt: Date | null): boolean {
  if (score === null) return false;
  if (score >= DECK_ENTER_SCORE) return true;
  return revealedAt !== null && score >= DECK_EXIT_SCORE;
}

/**
 * The shared CTEs: the eligible pool, the two halves of the taste signal, and
 * the aggregation that turns them into a score.
 *
 * `eligibilitySql` is the gate from `routes/feed.ts`, verbatim and without its
 * ORDER BY / LIMIT. It must expose `id`, `relationship_goal`,
 * `sexual_orientation`, `is_verified` and `created_at` among its columns, and
 * it must use `$1` for the viewer's id.
 */
function rankingCtes(eligibilitySql: string): string {
  return `
    ranked AS (
      ${eligibilitySql}
    ),
    viewer_meta AS (
      SELECT relationship_goal FROM users WHERE id = $1
    ),
    /*
     * The library statistics the tag weights are scaled by: how many photos
     * exist, and how many carry each tag. Computed once per rescore so every
     * pair in the run is priced by the same library -- see TAG_STRENGTH_SQL
     * in affinity.ts for why the scaling exists at all.
     */
    library AS (
      SELECT count(*)::int AS p FROM posts
    ),
    tag_docs AS (
      SELECT tag, count(*)::int AS docs
        FROM posts
        CROSS JOIN LATERAL unnest(posts.tags) AS tag
       GROUP BY tag
    ),
    /*
     * The viewer's half, from the summary row: their like count and how many
     * tags they lean towards, without aggregating either at read time.
     */
    vl AS (
      SELECT GREATEST(0, COALESCE(s.likes, 0)) AS likes
        FROM users u
        LEFT JOIN user_taste_summary s ON s.user_id = u.id
       WHERE u.id = $1
    ),
    viewer_pos AS (
      SELECT a.tag, ${TAG_STRENGTH_SQL} AS strength
        FROM user_tag_affinity a
        JOIN tag_docs d ON d.tag = a.tag
        CROSS JOIN library l
       WHERE a.user_id = $1 AND a.likes > a.dislikes
    ),
    /*
     * The length of the viewer's vector.
     *
     * Cosine similarity is the dot product divided by the length of each
     * vector, and the length is what stops a person with two strong opinions
     * from looking identical to one with two hundred. It is the square root of
     * the sum of the squared tag weights.
     */
    vb AS (
      SELECT sqrt(COALESCE(sum(strength * strength), 0)) AS norm
        FROM viewer_pos
    ),
    /*
     * The candidates' half, restricted to the tags the viewer leans towards.
     *
     * This is the difference between the ranking being fast and it being
     * hopeless. Fetching every candidate's whole vector is the whole affinity
     * table, and all but a fraction of it is tags the viewer has no opinion on,
     * which the overlap join would discard anyway. The restriction is not an
     * approximation: the tag half of the score only ever reads tags both people
     * lean towards.
     *
     * The tag-leading index serves this directly.
     */
    cand_pos AS (
      SELECT a.user_id, a.tag, ${TAG_STRENGTH_SQL} AS strength
        FROM user_tag_affinity a
        JOIN tag_docs d ON d.tag = a.tag
        CROSS JOIN library l
       WHERE a.tag IN (SELECT tag FROM viewer_pos)
         AND a.likes > a.dislikes
    ),
    /*
     * Each candidate's vector length.
     *
     * Over their *whole* positive vector, not just the tags they happen to
     * share with the viewer. This is the part of a cosine that cannot be
     * skipped: a cosine compares two vectors, and the length of the one on the
     * other side of the comparison is exactly what separates "these two agree
     * about everything they both care about" from "these two agree about the
     * two things they have in common out of a hundred opinions each".
     *
     * Truncating it to the shared tags would make every pair score 1.0, which
     * is a number that means nothing.
     *
     * Computed for *every* user rather than only the eligible ones, and that is
     * deliberate rather than sloppy. Restricting it to the eligible pool means
     * joining the aggregate to the ranked candidates, and that join takes the
     * aggregate out of a parallel plan: it measured 986ms serially against 74ms
     * in parallel over the same 400,000 rows. The filter is applied when the
     * result is joined on, so the rows that are thrown away cost a hash bucket
     * each rather than a whole serialised scan.
     *
     * This is the one part of the ranking that reads every user's whole
     * vector, and it is the reason the ranking is a background job rather than
     * something computed on every feed request.
     */
    br AS (
      SELECT a.user_id, sqrt(COALESCE(sum(${TAG_STRENGTH_SQL} * ${TAG_STRENGTH_SQL}), 0)) AS norm
        FROM user_tag_affinity a
        JOIN tag_docs d ON d.tag = a.tag
        CROSS JOIN library l
       WHERE a.likes > a.dislikes
       GROUP BY a.user_id, l.p
    ),
    ov AS (
      SELECT cp.user_id,
             sum(vp.strength * cp.strength) AS earned,
             count(*) AS shared_count,
             array_agg(cp.tag ORDER BY vp.strength * cp.strength DESC, cp.tag) AS shared_tags
        FROM cand_pos cp
        JOIN viewer_pos vp ON vp.tag = cp.tag
       WHERE cp.user_id IN (SELECT id FROM ranked)
       GROUP BY cp.user_id
    ),
    co AS (
      /*
       * One count per photo liked by both people. Saturation below keeps a
       * prolific pair from running away with the score; the evidence does not
       * lose weight just because it is old.
       */
       SELECT r2.user_id,
               count(*) AS co_count
        FROM post_reactions r1
        JOIN post_reactions r2
          ON r2.post_id = r1.post_id
         AND r2.action = 'like'
         AND r2.user_id <> r1.user_id
       WHERE r1.user_id = $1 AND r1.action = 'like'
       GROUP BY r2.user_id
    ),
    cl AS (
      SELECT r.id AS user_id, GREATEST(0, COALESCE(s.likes, 0)) AS likes
        FROM ranked r
        LEFT JOIN user_taste_summary s ON s.user_id = r.id
    ),
    scored AS (
      SELECT
        ranked.*,
        round(CAST(
          ( ${CO_LIKE_SHARE} * (COALESCE(co.co_count, 0)::float / (COALESCE(co.co_count, 0) + ${CO_LIKE_SATURATION}))
          + ${TAG_SHARE} * LEAST(1,
              CASE
                WHEN vb.norm > 0 AND COALESCE(br.norm, 0) > 0
                THEN COALESCE(ov.earned, 0) / (vb.norm * br.norm)
                ELSE 0
              END)
          )
          * LEAST(1, LEAST(vl.likes, COALESCE(cl.likes, 0))::float / ${CONFIDENCE_MIN_LIKES})
        AS numeric), 2) AS taste_affinity,

        COALESCE(co.co_count, 0) AS co_liked_count,
        COALESCE(ov.shared_tags, '{}') AS shared_tags,

        -- Kept for informational display only (not used in scoring).
        (viewer_meta.relationship_goal = ranked.relationship_goal) AS shared_goals
      FROM ranked
      LEFT JOIN ov ON ov.user_id = ranked.id
      LEFT JOIN co ON co.user_id = ranked.id
      LEFT JOIN br ON br.user_id = ranked.id
      LEFT JOIN cl ON cl.user_id = ranked.id
      CROSS JOIN vl
      CROSS JOIN vb
      CROSS JOIN viewer_meta
    ),
    final AS (
      SELECT
        scored.*,
        -- Score is now purely photo taste affinity × 100.
        round(LEAST(100, ${MATCH_WEIGHTS.taste} * scored.taste_affinity)) AS score
      FROM scored
    )
  `;
}

/**
 * The complete ranked SELECT for one viewer.
 *
 * A single definition, used by the rescore and by anything else that needs the
 * same numbers, so the two cannot disagree.
 */
export function rankingSelectSql(eligibilitySql: string): string {
  return `WITH ${rankingCtes(eligibilitySql)} SELECT * FROM final`;
}

/**
 * Recomputes scores for one person's pairs and stores each score in both
 * directions.
 *
 * Rows involving this person are replaced, including the reverse rows. A
 * changed reaction affects both their own ranking and how everyone else ranks
 * them. The eligibility SQL must omit the already-swiped gate: someone who has
 * swiped may still appear in the other person's deck.
 *
 * A pair whose score reaches `DECK_ENTER_SCORE` is marked revealed, once; the
 * marker survives every later rescore so the deck's hysteresis has something to
 * read. A full rescore therefore also backfills the reveal state for every
 * pair already over the entry score.
 *
 * Returns the number of candidate pairs scored (not the two stored rows per
 * pair).
 */
export async function rescoreForViewer(
  client: Queryable,
  viewerId: string,
  eligibilitySql: string
): Promise<number> {
  /*
   * The pair-reveal state has to survive the replace below. The DELETE is
   * load-bearing -- it removes pairs the current eligibility no longer admits
   * -- but it would also wipe `revealed_at`, and "once revealed" only means
   * anything if it survives every rescore. Snapshot the reveal times first
   * and offer them back to the INSERT.
   *
   * Both directions of a pair carry the same reveal time by construction; the
   * earliest wins if they ever disagree, and DISTINCT ON keeps one row per
   * partner so the join below cannot duplicate a pair.
   */
  const { rows: kept } = await client.query<{ partner_id: string; revealed_at: Date }>(
    `SELECT DISTINCT ON (partner_id) partner_id, revealed_at
       FROM (
              SELECT candidate_id AS partner_id, revealed_at
                FROM match_scores
               WHERE viewer_id = $1 AND revealed_at IS NOT NULL
              UNION ALL
              SELECT viewer_id AS partner_id, revealed_at
                FROM match_scores
               WHERE candidate_id = $1 AND revealed_at IS NOT NULL
            ) snaps
      ORDER BY partner_id, revealed_at`,
    [viewerId]
  );

  // Replace every cached direction involving this person. A changed reaction
  // affects both their own ranking and how everyone else ranks them.
  await client.query(`DELETE FROM match_scores WHERE viewer_id = $1 OR candidate_id = $1`, [
    viewerId,
  ]);

  const { rowCount } = await client.query(
    `
    INSERT INTO match_scores
      (viewer_id, candidate_id, score, taste_affinity, co_liked_count, shared_tags, band, revealed_at, computed_at)
    SELECT pair.viewer_id, pair.candidate_id, f.score, f.taste_affinity, f.co_liked_count, f.shared_tags,
           ${bandSql('f.score')},
           COALESCE(k.revealed_at, CASE WHEN f.score >= ${DECK_ENTER_SCORE} THEN now() END),
           now()
      FROM (${rankingSelectSql(eligibilitySql)}) f
      CROSS JOIN LATERAL (
        VALUES ($1::uuid, f.id), (f.id, $1::uuid)
      ) AS pair(viewer_id, candidate_id)
      LEFT JOIN unnest($2::uuid[], $3::timestamptz[]) AS k(partner_id, revealed_at)
        ON k.partner_id = f.id
     ORDER BY pair.viewer_id, pair.candidate_id
    ON CONFLICT (viewer_id, candidate_id) DO UPDATE SET
      score = EXCLUDED.score,
      taste_affinity = EXCLUDED.taste_affinity,
      co_liked_count = EXCLUDED.co_liked_count,
      shared_tags = EXCLUDED.shared_tags,
      band = EXCLUDED.band,
      computed_at = EXCLUDED.computed_at
    `,
    [viewerId, kept.map((row) => row.partner_id), kept.map((row) => row.revealed_at)]
  );

  return Math.floor((rowCount ?? 0) / 2);
}

/** Rescores a known set of viewers, keeping one shared eligibility definition. */
export async function rescoreViewers(
  client: Queryable,
  viewerIds: readonly string[],
  eligibilitySql: string
): Promise<number> {
  let scored = 0;
  for (const viewerId of viewerIds) {
    scored += await rescoreForViewer(client, viewerId, eligibilitySql);
  }
  return scored;
}

/**
 * The sentence under a match percentage.
 *
 * Built here rather than in SQL because it is presentation, and because the
 * ordering of the two claims is a judgement the client already made: named
 * photos first, because "you both liked this specific thing" is checkable and a
 * shared tag is only a weaker claim about a broader subject.
 */
export function describeAffinity(coLikedPosts: number, sharedTags: string[]): string | null {
  const posts =
    coLikedPosts === 1
      ? 'You both liked the same photo'
      : `You both liked ${coLikedPosts} of the same photos`;
  const tags = sharedTags.slice(0, 3).join(', ');

  if (coLikedPosts > 0 && tags) return `${posts}, tagged ${tags}`;
  if (coLikedPosts > 0) return posts;
  if (tags) return `You both like photos tagged ${tags}`;
  return null;
}
