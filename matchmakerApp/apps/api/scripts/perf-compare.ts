/**
 * Times the two similarity measures against the synthetic dataset.
 *
 * The cosine needs each candidate's whole vector, so it reads more than the
 * normalisation it replaced. This measures the difference rather than assuming
 * it, because "it is slower" is only interesting with the number attached.
 */
import { Client } from 'pg';

import { HALF_LIFE_SECONDS } from '../src/affinity';
import { TAG_STRENGTH_SQL } from '../src/affinity';

const ELIGIBILITY = `
  SELECT u.id, u.relationship_goal, u.sexual_orientation, u.is_verified, u.created_at
    FROM users u
   WHERE u.id <> $1
`;

const STRENGTH = TAG_STRENGTH_SQL;

/** The normalisation that was there before: shared weight over the smaller tag count. */
const OLD = `
,
    vl AS (
      SELECT GREATEST(0, COALESCE(s.likes, 0)) AS likes
        FROM users u LEFT JOIN user_taste_summary s ON s.user_id = u.id WHERE u.id = $1
    ),
    viewer_pos AS (
      SELECT a.tag, ${STRENGTH} AS strength FROM user_tag_affinity a
       WHERE a.user_id = $1 AND a.likes > a.dislikes
    ),
    vb AS (
      SELECT GREATEST(0, COALESCE(s.positive_tags, 0)) AS breadth
        FROM users u LEFT JOIN user_taste_summary s ON s.user_id = u.id WHERE u.id = $1
    ),
    cand_pos AS (
      SELECT a.user_id, a.tag, ${STRENGTH} AS strength FROM user_tag_affinity a
       WHERE a.tag IN (SELECT tag FROM viewer_pos) AND a.likes > a.dislikes
    ),
    br AS (
      SELECT r.id AS user_id, GREATEST(0, COALESCE(s.positive_tags, 0)) AS breadth
        FROM ranked r LEFT JOIN user_taste_summary s ON s.user_id = r.id
    ),
    ov AS (
      SELECT cp.user_id, sum(vp.strength * cp.strength) AS earned
        FROM cand_pos cp JOIN viewer_pos vp ON vp.tag = cp.tag
       WHERE cp.user_id IN (SELECT id FROM ranked) GROUP BY cp.user_id
    ),
    co AS (
      SELECT r2.user_id, sum(exp(- extract(epoch FROM (now() - r1.created_at)) * ln(2) / ${HALF_LIFE_SECONDS})) AS co_likes,
             count(*) AS co_count
        FROM post_reactions r1 JOIN post_reactions r2
          ON r2.post_id = r1.post_id AND r2.action = 'like' AND r2.user_id <> r1.user_id
       WHERE r1.user_id = $1 AND r1.action = 'like' GROUP BY r2.user_id
    ),
    cl AS (
      SELECT r.id AS user_id, GREATEST(0, COALESCE(s.likes, 0)) AS likes
        FROM ranked r LEFT JOIN user_taste_summary s ON s.user_id = r.id
    ),
    scored AS (
      SELECT ranked.*,
        round(CAST(
          ( 0.65 * (COALESCE(co.co_likes, 0)::float / (COALESCE(co.co_likes, 0) + 2))
          + 0.35 * LEAST(1, COALESCE(ov.earned, 0) / GREATEST(1, LEAST(vb.breadth, COALESCE(br.breadth, 0)))))
          * LEAST(1, LEAST(vl.likes, COALESCE(cl.likes, 0))::float / 5)
        AS numeric), 2) AS taste_affinity
        FROM ranked
        LEFT JOIN ov ON ov.user_id = ranked.id
        LEFT JOIN co ON co.user_id = ranked.id
        LEFT JOIN br ON br.user_id = ranked.id
        LEFT JOIN cl ON cl.user_id = ranked.id
        CROSS JOIN vl CROSS JOIN vb
    )
    SELECT sum(taste_affinity) FROM scored`;

/** The cosine: shared weight over the product of the two vector lengths. */
const NEW = `
,
    vl AS (
      SELECT GREATEST(0, COALESCE(s.likes, 0)) AS likes
        FROM users u LEFT JOIN user_taste_summary s ON s.user_id = u.id WHERE u.id = $1
    ),
    viewer_pos AS (
      SELECT a.tag, ${STRENGTH} AS strength FROM user_tag_affinity a
       WHERE a.user_id = $1 AND a.likes > a.dislikes
    ),
    vb AS (SELECT sqrt(COALESCE(sum(strength * strength), 0)) AS norm FROM viewer_pos),
    cand_pos AS (
      SELECT a.user_id, a.tag, ${STRENGTH} AS strength FROM user_tag_affinity a
       WHERE a.tag IN (SELECT tag FROM viewer_pos) AND a.likes > a.dislikes
    ),
    br AS (
      SELECT a.user_id, sqrt(COALESCE(sum(${STRENGTH} * ${STRENGTH}), 0)) AS norm
        FROM user_tag_affinity a
       WHERE a.likes > a.dislikes AND a.user_id IN (SELECT id FROM ranked)
       GROUP BY a.user_id
    ),
    ov AS (
      SELECT cp.user_id, sum(vp.strength * cp.strength) AS earned
        FROM cand_pos cp JOIN viewer_pos vp ON vp.tag = cp.tag
       WHERE cp.user_id IN (SELECT id FROM ranked) GROUP BY cp.user_id
    ),
    co AS (
      SELECT r2.user_id, sum(exp(- extract(epoch FROM (now() - r1.created_at)) * ln(2) / ${HALF_LIFE_SECONDS})) AS co_likes,
             count(*) AS co_count
        FROM post_reactions r1 JOIN post_reactions r2
          ON r2.post_id = r1.post_id AND r2.action = 'like' AND r2.user_id <> r1.user_id
       WHERE r1.user_id = $1 AND r1.action = 'like' GROUP BY r2.user_id
    ),
    cl AS (
      SELECT r.id AS user_id, GREATEST(0, COALESCE(s.likes, 0)) AS likes
        FROM ranked r LEFT JOIN user_taste_summary s ON s.user_id = r.id
    ),
    scored AS (
      SELECT ranked.*,
        round(CAST(
          ( 0.65 * (COALESCE(co.co_likes, 0)::float / (COALESCE(co.co_likes, 0) + 2))
          + 0.35 * LEAST(1, CASE
              WHEN vb.norm > 0 AND COALESCE(br.norm, 0) > 0
              THEN COALESCE(ov.earned, 0) / (vb.norm * br.norm)
              ELSE 0 END))
          * LEAST(1, LEAST(vl.likes, COALESCE(cl.likes, 0))::float / 5)
        AS numeric), 2) AS taste_affinity
        FROM ranked
        LEFT JOIN ov ON ov.user_id = ranked.id
        LEFT JOIN co ON co.user_id = ranked.id
        LEFT JOIN br ON br.user_id = ranked.id
        LEFT JOIN cl ON cl.user_id = ranked.id
        CROSS JOIN vl CROSS JOIN vb
    )
    SELECT sum(taste_affinity) FROM scored`;

/**
 * Refuses to run without the synthetic dataset.
 *
 * `SET search_path = perf, public` falls back to the public schema when the
 * perf schema is missing, so without this check the script would quietly
 * measure the eight-account live database and report it under a heading that
 * says two thousand. A measurement of the wrong thing is worse than no
 * measurement.
 */
async function requirePerfSchema(client: Client): Promise<void> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM information_schema.tables
      WHERE table_schema = 'perf' AND table_name = 'users'`
  );
  if (rows[0]?.n === '0') {
    throw new Error(
      'The perf schema is not there. Build it first:\n' +
        '  psql $DATABASE_URL -f db/perf-dataset.sql'
    );
  }
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://matchmakers:Adminpassword123@127.0.0.1:5432/matchmakers',
  });
  await client.connect();
  await requirePerfSchema(client);
  await client.query('SET search_path = perf, public');

  const { rows } = await client.query<{ id: string }>('SELECT id FROM users ORDER BY id LIMIT 3');

  for (const [label, sql] of [
    ['the old normalisation (shared weight / smaller tag count)', OLD],
    ['the cosine (shared weight / both vector lengths)', NEW],
  ] as const) {
    console.log(`=== ${label} ===`);
    for (const viewer of rows) {
      const query = `WITH ranked AS (${ELIGIBILITY}) ${sql}`;
      const started = Date.now();
      await client.query(query, [viewer.id]);
      console.log(`  ${Date.now() - started}ms`);
    }
    console.log('');
  }

  await client.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
