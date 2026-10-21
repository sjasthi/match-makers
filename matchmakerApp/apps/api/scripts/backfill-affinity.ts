/**
 * Rebuilds the tag-weight vectors from the reactions table.
 *
 * The affinity table is written as reactions land, so this is only needed once
 * -- for history that predates it, or after a bulk edit of `post_reactions`.
 * It is also the repair button: the vectors are derived from the reactions, so
 * running it makes them correct again whatever happened to them.
 *
 *   npm run admin:backfill --workspace=apps/api
 */
import { backfillAffinity } from '../src/affinity';
import { pool } from '../src/db';

async function main(): Promise<void> {
  const rows = await backfillAffinity(pool);
  const { rows: counts } = await pool.query<{ vectors: string; summaries: string }>(
    `SELECT (SELECT count(*) FROM user_tag_affinity)::text AS vectors,
            (SELECT count(*) FROM user_taste_summary)::text AS summaries`
  );

  console.log(`Rebuilt ${rows} tag vectors.`);
  console.log(
    `  ${counts[0]?.vectors ?? 0} rows in user_tag_affinity, ${counts[0]?.summaries ?? 0} in user_taste_summary.`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
