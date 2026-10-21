/**
 * Grant and revoke admin access.
 *
 *   npm run admin -- list
 *   npm run admin -- grant amara@example.com
 *   npm run admin -- revoke amara@example.com
 *
 * A CLI rather than an HTTP endpoint, deliberately. A `POST /admin/grant` route
 * is a privilege-escalation surface: it would exist in the deployed app, be
 * reachable by anyone who authenticated, and be one forgotten
 * `if (dev)` away from being reachable by anyone. This needs `DATABASE_URL`, so
 * whoever can run it already holds full database access and the flag grants them
 * nothing new.
 *
 * It exists because the account to promote is a decision, not a default. Seeding
 * an admin would mean choosing one before anybody has registered; the mock
 * adapter has a demo account for exactly this, but there is no equivalent here
 * and inventing one would be the seed you did not ask for. Register normally,
 * then name the account.
 */

import { pool, registerTypeParsers } from '../src/db';

type Command = 'list' | 'grant' | 'revoke';

interface Account {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  created_at: Date;
}

/** Bounded, because this prints to a terminal. */
async function listAccounts(): Promise<Account[]> {
  const { rows } = await pool.query<Account>(
    `SELECT id, email, name, is_admin, created_at
       FROM users
      ORDER BY is_admin DESC, created_at ASC
      LIMIT 200`
  );
  return rows;
}

/**
 * Suggests near matches for an email that did not resolve.
 *
 * The point of a console rather than raw SQL: accounts are picked by typing an
 * address, and `dem0` for `demo` is the mistake a person actually makes. A
 * silent "no such account" leaves you guessing.
 *
 * Matches on the first three characters of the local part rather than using
 * `similarity()` from `pg_trgm`. Trigram search is the better tool and the
 * extension is available here, but making a suggestion depend on a
 * `CREATE EXTENSION` somebody has not run -- and which `schema.sql` deliberately
 * does not install -- is a poor trade. Three characters catches transpositions
 * and typos, which is the entire job.
 */
async function suggestionsFor(email: string): Promise<string[]> {
  const localPart = (email.split('@')[0] ?? '').toLowerCase();

  // Too short to be selective, so a one- or two character guess would list every
  // account. Better to say nothing than to suggest everything.
  if (localPart.length < 3) return [];

  const { rows } = await pool.query<{ email: string }>(
    `SELECT email
       FROM users
      WHERE email ILIKE $1
      ORDER BY created_at ASC
      LIMIT 5`,
    [`%${localPart.slice(0, 3)}%`]
  );
  return rows.map((row) => row.email);
}

async function setAdmin(email: string, admin: boolean): Promise<number> {
  const { rowCount } = await pool.query(
    'UPDATE users SET is_admin = $2, updated_at = now() WHERE lower(btrim(email)) = lower(btrim($1))',
    [email, admin]
  );
  return rowCount ?? 0;
}

async function main(): Promise<void> {
  await registerTypeParsers();

  const [command, argument] = process.argv.slice(2);

  if (command === 'list') {
    const accounts = await listAccounts();
    if (accounts.length === 0) {
      console.log('No accounts yet. Register one in the app, then grant it admin.');
      return;
    }

    const admins = accounts.filter((account) => account.is_admin).length;
    console.log(`${accounts.length} account(s), ${admins} with admin:\n`);

    for (const account of accounts) {
      const role = account.is_admin ? 'admin  ' : 'member ';
      console.log(`  ${role}  ${account.email.padEnd(38)} ${account.name}  (${account.id})`);
    }
    return;
  }

  if (command !== 'grant' && command !== 'revoke') {
    console.error(
      [
        'Usage:',
        '  npm run admin -- list',
        '  npm run admin -- grant <email>',
        '  npm run admin -- revoke <email>',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  if (!argument) {
    console.error(`\`${command}\` needs an email address.`);
    process.exitCode = 1;
    return;
  }

  const makingAdmin = command === 'grant';
  const changed = await setAdmin(argument, makingAdmin);

  if (changed === 0) {
    console.error(`\n  No account with the email "${argument}".\n`);
    const suggestions = await suggestionsFor(argument);
    if (suggestions.length > 0) {
      console.error('  Did you mean:');
      for (const suggestion of suggestions) console.error(`    ${suggestion}`);
      console.error('');
    }
    console.error('  Register the account first, then grant it.');
    process.exitCode = 1;
    return;
  }

  const { rows } = await pool.query<{ name: string; email: string }>(
    'SELECT name, email FROM users WHERE lower(btrim(email)) = lower(btrim($1))',
    [argument]
  );
  const account = rows[0];

  // Names the account, not just the success. Picking the right person out of a
  // few similar addresses is the whole task, and "granted admin" alone does not
  // tell you it picked the right one.
  console.log(
    `\n  ${makingAdmin ? 'granted admin' : 'revoked admin'}:  ${account?.name ?? '?'} <${account?.email ?? argument}>\n`
  );
}

main()
  .catch((error: unknown) => {
    console.error(`\n  Failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
