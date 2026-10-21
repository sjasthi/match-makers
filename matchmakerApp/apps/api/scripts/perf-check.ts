/**
 * Measures the rescore and the feed read against the synthetic dataset.
 *
 * The `perf` schema has the same shape as the real one, and the ranking SQL is
 * unqualified, so pointing `search_path` at it runs the *same* statements
 * against the bigger data.
 */
import { Client } from 'pg';

import { rescoreForViewer, rankingSelectSql } from '../src/matching';

const ELIGIBILITY = `
  SELECT u.id, u.relationship_goal, u.sexual_orientation, u.is_verified, u.created_at
    FROM users u
   WHERE u.id <> $1
`;

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

  const { rows: viewers } = await client.query<{ id: string }>(
    'SELECT id FROM users ORDER BY id LIMIT 5'
  );
  const first = viewers[0];
  if (!first) throw new Error('no viewers');

  console.log('=== the rescore, one viewer (2,000 candidates, 400,000 vectors) ===');
  for (const viewer of viewers.slice(0, 3)) {
    const started = Date.now();
    const count = await rescoreForViewer(client, viewer.id, ELIGIBILITY);
    console.log(`  ${count} candidate(s) scored in ${Date.now() - started}ms`);
  }

  console.log('');
  console.log('=== the feed read, from the stored ranking ===');
  for (let i = 0; i < 3; i += 1) {
    const started = Date.now();
    await client.query(
      `SELECT candidate_id, score FROM match_scores
        WHERE viewer_id = $1 ORDER BY score DESC, candidate_id LIMIT 10`,
      [first.id]
    );
    console.log(`  read in ${Date.now() - started}ms`);
  }

  console.log('');
  console.log('=== the ranking, computed rather than read ===');
  const started = Date.now();
  await client.query(rankingSelectSql(ELIGIBILITY), [first.id]);
  console.log(`  computed in ${Date.now() - started}ms`);

  await client.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
