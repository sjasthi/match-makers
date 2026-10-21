/**
 * Applies `db/schema.sql`.
 *
 * Run with `npm run migrate`. Previously this was a shell one-liner
 * (`psql "$DATABASE_URL" ...`), which could not work: npm does not read `.env`,
 * so `$DATABASE_URL` was empty unless the caller happened to have exported it.
 * The server reads `.env` itself via `process.loadEnvFile`, so the two halves
 * disagreed about where configuration comes from.
 *
 * Applying the SQL through `pg` rather than shelling out to `psql` also means
 * this needs no client binary on `PATH` -- which matters on a machine where the
 * server can reach Postgres over TCP but the CLI is not installed.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, registerTypeParsers } from '../src/db';

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  await registerTypeParsers();

  const sql = await readFile(join(here, 'schema.sql'), 'utf8');

  // The file wraps itself in BEGIN/COMMIT, so this is one round trip and it
  // either applies completely or not at all.
  await pool.query(sql);

  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );

  console.log(`Schema applied. ${rows.length} tables present:`);
  for (const row of rows) console.log(`  ${row.table_name}`);
  console.log('\nRe-running is safe: enums are guarded and tables use IF NOT EXISTS.');
}

main()
  .catch((error: unknown) => {
    console.error('\nMigration failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
