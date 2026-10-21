import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import pgArray from 'postgres-array';
import { env } from '@/env';

/**
 * The Postgres connection pool.
 *
 * One module-level pool rather than a client per request: Postgres forks a
 * backend process per connection, and opening one per request turns a traffic
 * spike into a fork storm. The pool caps the damage instead.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  // Fail a query rather than queue it forever. The mock had no equivalent
  // problem -- a rewrite of a JSON blob cannot hang -- and an unbounded wait is
  // the failure mode this database introduces in exchange for the rest of it.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

/**
 * Postgres reports every error as a warning on the pool, which otherwise leaves
 * a dead connection sitting in the pool until something tries to use it. This
 * is what turns "one request failed" into "the pool healed itself".
 */
pool.on('error', (error) => {
  console.error('[db] idle client error', error.message);
});

/**
 * Run a callback inside a transaction, rolling back on any throw.
 *
 * Needed wherever one logical operation is more than one statement -- creating
 * a match and returning it, or writing a profile and its preferences. Without
 * it, a failure between statements leaves a user with preferences and no
 * profile row, which is precisely the class of broken data the mock's single
 * atomic JSON rewrite could never produce.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** `SELECT`, returning rows. */
export function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

/**
 * The minimum a helper needs to be usable inside or outside a transaction.
 *
 * `Pool` and `PoolClient` both satisfy it, so a helper written against this can
 * be called with either without the caller casting between two types that mean
 * the same thing. This exists because `loadMatchSummary` and
 * `assertParticipant` are called both ways.
 */
export type Queryable = Pick<Pool, 'query'>;

/**
 * Teach `pg` how to read the column types this schema uses.
 *
 * Must run once, before the first query. `server.ts` awaits it before
 * listening.
 *
 * Two defaults are wrong here, and both fail quietly rather than loudly:
 *
 * - `date` comes back as a JS Date. A birthday is a calendar date, and
 *   `User.dateOfBirth` is documented as an ISO date string. Worse, the driver
 *   builds that Date in local time, so a user west of UTC would be shifted a day
 *   backwards in every age calculation.
 * - `gender[]` and `relationship_goal[]` come back as the raw `'{a,b}'` string,
 *   because `pg` only knows how to parse arrays of types it ships with and these
 *   are ours. The OIDs are assigned by `CREATE TYPE`, so they differ between
 *   databases and cannot be written down -- they have to be looked up.
 */
export async function registerTypeParsers(): Promise<void> {
  types.setTypeParser(types.builtins.DATE, (value: string) => value);

  const { rows } = await pool.query<{ oid: number }>(
    `SELECT array_type.oid
       FROM pg_type AS element
       JOIN pg_type AS array_type ON array_type.typelem = element.oid
      WHERE array_type.typcategory = 'A'
        AND element.typname IN ('gender', 'relationship_goal')`
  );

  // `pg.types.arrayParser` is not usable for this. Its `create` signature is
  // `create(source, transform)` -- it builds a parser bound to one literal
  // value -- and passing it an options object instead makes it call
  // `postgres-array` with `undefined`, which crashes V8 with an allocation
  // failure rather than throwing something catchable. `postgres-array` is the
  // library underneath it and is the function actually wanted.
  const parseArray = (value: string): string[] => pgArray.parse(value) as string[];

  for (const row of rows) {
    types.setTypeParser(row.oid, parseArray);
  }
}

/**
 * Postgres `BIGINT` arrives as a string, because it can exceed what a JS number
 * holds safely.
 *
 * `COUNT(*)` is the only place that happens here, and it never does: these are
 * row counts on a feed page and a conversation list, nowhere near 2^53. Reading
 * them as numbers keeps the JSON responses the same shape the mobile app's
 * `Paginated<T>` expects, instead of making every consumer remember.
 */
export function count(value: string | number): number {
  return typeof value === 'string' ? Number(value) : value;
}
