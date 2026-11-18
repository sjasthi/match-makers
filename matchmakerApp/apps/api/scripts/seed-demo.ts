/**
 * Seeds the live API's development database with 20 demo accounts only.
 *
 *   npm run seed:demo --workspace=apps/api -- --confirm
 *
 * This is deliberately opt-in and refuses production. It creates or refreshes
 * `candidate1`–`candidate20@matchmakers.dev`, their profile fields, and their
 * discovery preferences. It does not create photos, posts, reactions, swipes,
 * or matches.
 */
/* eslint-disable no-console -- this is an operator-facing CLI. */
import { pool, withTransaction } from '../src/db';
import { isProduction } from '../src/env';
import { hashPassword } from '../src/password';
import { buildDemoCandidates, DEMO_ACCOUNT_PASSWORD } from '../src/demoSeed';

async function seedDemoAccounts(): Promise<string[]> {
  const candidates = buildDemoCandidates();
  const passwordHashes: string[] = [];

  // Hash separately per account so identical demo passwords do not share salts.
  for (let index = 0; index < candidates.length; index += 1) {
    passwordHashes.push(await hashPassword(DEMO_ACCOUNT_PASSWORD));
  }

  return withTransaction(async (client) => {
    for (const [index, candidate] of candidates.entries()) {
      const passwordHash = passwordHashes[index];
      if (!passwordHash) throw new Error(`Could not hash password for ${candidate.email}`);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (
           email, password_hash, name, date_of_birth, gender,
           sexual_orientation, relationship_goal, bio,
           latitude, longitude, city, country
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           date_of_birth = EXCLUDED.date_of_birth,
           gender = EXCLUDED.gender,
           sexual_orientation = EXCLUDED.sexual_orientation,
           relationship_goal = EXCLUDED.relationship_goal,
           bio = EXCLUDED.bio,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           city = EXCLUDED.city,
           country = EXCLUDED.country,
           updated_at = now()
         RETURNING id`,
        [
          candidate.email,
          passwordHash,
          candidate.name,
          candidate.dateOfBirth,
          candidate.gender,
          candidate.sexualOrientation,
          candidate.relationshipGoal,
          candidate.bio,
          candidate.location.latitude,
          candidate.location.longitude,
          candidate.location.city,
          candidate.location.country,
        ]
      );

      const userId = rows[0]?.id;
      if (!userId) throw new Error(`Could not create ${candidate.email}`);

      await client.query(
        `INSERT INTO user_preferences (
           user_id, age_min, age_max, distance_mode, max_distance,
           genders, relationship_goals
         )
         VALUES ($1, $2, $3, 'global', 500, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           age_min = EXCLUDED.age_min,
           age_max = EXCLUDED.age_max,
           distance_mode = EXCLUDED.distance_mode,
           max_distance = EXCLUDED.max_distance,
           genders = EXCLUDED.genders,
           relationship_goals = EXCLUDED.relationship_goals`,
        [
          userId,
          candidate.preferences.ageRange.min,
          candidate.preferences.ageRange.max,
          candidate.preferences.genders,
          candidate.preferences.relationshipGoals,
        ]
      );
    }

    return candidates.map((candidate) => candidate.email);
  });
}

async function main(): Promise<void> {
  if (isProduction) {
    throw new Error('Demo accounts cannot be seeded in production.');
  }

  if (!process.argv.slice(2).includes('--confirm')) {
    console.error(
      [
        'This creates or refreshes the demo accounts and their preferences only.',
        'It does not create photos, posts, reactions, swipes, or matches.',
        'Run again with --confirm to proceed:',
        '  npm run seed:demo --workspace=apps/api -- --confirm',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  const result = await seedDemoAccounts();
  console.log(`Seeded ${result.length} demo accounts.`);
  console.log(`Shared demo password: ${DEMO_ACCOUNT_PASSWORD}`);
  for (const email of result) console.log(`  ${email}`);
}

main()
  .catch((error: unknown) => {
    console.error(`\n  Failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
