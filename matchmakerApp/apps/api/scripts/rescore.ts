/**
 * Rescores every account's ranking.
 *
 * The feed reads `match_scores` rather than computing the ranking per request,
 * because computing it costs 569ms over 400,000 rows and the answer only
 * changes when somebody reacts. This is the job that keeps it fresh.
 *
 *   npm run rescore --workspace=apps/api              # everyone
 *   npm run rescore --workspace=apps/api -- <email>   # one person
 *
 * In a real deployment this would run on a timer rather than by hand. The
 * important property -- that the feed is a cheap read of a stored result -- does
 * not depend on how often it runs, only on how stale it is allowed to get.
 */
import { pool } from '../src/db';
import { eligibilitySql } from '../src/eligibility';
import { rescoreForViewer } from '../src/matching';

async function main(): Promise<void> {
  const only = process.argv[2];

  const { rows: viewers } = only
    ? await pool.query<{ id: string; email: string }>(
        'SELECT id, email FROM users WHERE lower(email) = lower($1)',
        [only]
      )
    : await pool.query<{ id: string; email: string }>('SELECT id, email FROM users ORDER BY email');

  if (viewers.length === 0) {
    console.log(only ? `No account with the email "${only}".` : 'No accounts.');
    return;
  }

  const started = Date.now();
  let scored = 0;

  for (const viewer of viewers) {
    const count = await rescoreForViewer(pool, viewer.id, eligibilitySql());
    scored += count;
    console.log(`  ${viewer.email.padEnd(38)} ${count} candidate(s)`);
  }

  console.log(
    `\nScored ${viewers.length} account(s), ${scored} candidate pair(s) in ${Date.now() - started}ms.`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
