import type { User } from '@match-makers/shared';
import { pool } from '@/db';
import { ApiError } from '@/errors';
import {
  toPhoto,
  toPreferences,
  toUser,
  type PhotoRow,
  type UserPreferencesRow,
  type UserRow,
} from '@/db/rows';

/**
 * Reading users.
 *
 * A profile is three tables, so reading one is three reads -- unless they are
 * gathered in a single statement, which is what the `json_agg` subqueries below
 * are for. Three round trips per profile becomes one, and more importantly it
 * cannot observe a half-written profile, which the mock's array-based `find`
 * also could not but for a different reason: it was all one document.
 */

const SELECT_USER = `
  SELECT
    u.id, u.email, u.name, u.date_of_birth, u.gender, u.sexual_orientation,
    u.relationship_goal, u.bio, u.latitude, u.longitude, u.city, u.country,
    u.is_verified, u.created_at, u.updated_at,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'id', ph.id,
            'user_id', ph.user_id,
            'url', ph.url,
            'is_primary', ph.is_primary,
            'position', ph.position
          ) ORDER BY ph.position
        )
        FROM photos ph
        WHERE ph.user_id = u.id
      ),
      '[]'::json
    ) AS photos,
    p.user_id AS prefs_user_id,
    p.age_min, p.age_max, p.distance_mode, p.max_distance,
    p.genders, p.relationship_goals
  FROM users u
  LEFT JOIN user_preferences p ON p.user_id = u.id
`;

interface UserWithRelationsRow extends UserRow {
  photos: PhotoRow[];
  prefs_user_id: string | null;
  age_min: number | null;
  age_max: number | null;
  distance_mode: UserPreferencesRow['distance_mode'] | null;
  max_distance: number | null;
  genders: UserPreferencesRow['genders'] | null;
  relationship_goals: UserPreferencesRow['relationship_goals'] | null;
}

function assemble(row: UserWithRelationsRow): User {
  const hasPreferences = row.prefs_user_id !== null;
  const preferences = hasPreferences
    ? toPreferences({
        user_id: row.prefs_user_id as string,
        age_min: row.age_min as number,
        age_max: row.age_max as number,
        distance_mode: row.distance_mode as UserPreferencesRow['distance_mode'],
        max_distance: row.max_distance as number,
        genders: row.genders as UserPreferencesRow['genders'],
        relationship_goals: row.relationship_goals as UserPreferencesRow['relationship_goals'],
      })
    : null;

  return toUser(row, (row.photos ?? []).map(toPhoto), preferences);
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query<UserWithRelationsRow>(`${SELECT_USER} WHERE u.id = $1`, [id]);
  const row = rows[0];
  return row ? assemble(row) : null;
}

/** 404s rather than returning null, for routes where a missing user is an error. */
export async function getUserById(id: string): Promise<User> {
  const user = await findUserById(id);
  if (!user) throw ApiError.notFound('Profile not found');
  return user;
}

/**
 * Email lookup for login.
 *
 * `email` is stored lower-cased and the column has a CHECK that enforces it, so
 * a plain equality match is already case-insensitive as long as the caller
 * lower-cases first. `MockAuthAdapter` does that on register and compares
 * case-insensitively on login; both halves are kept here.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query<UserWithRelationsRow>(`${SELECT_USER} WHERE u.email = $1`, [
    email.trim().toLowerCase(),
  ]);
  const row = rows[0];
  return row ? assemble(row) : null;
}

/**
 * Used only by `/auth/login`, because it is the only query that legitimately
 * needs the hash. Everything else goes through `getUserById`, so a password
 * hash cannot be selected by accident and shipped inside a `User` response.
 *
 * Returns the id alongside the hash so login can go straight on to reading the
 * profile instead of looking the same email up a second time.
 */
export async function findCredentialsByEmail(
  email: string
): Promise<{ id: string; passwordHash: string } | null> {
  const { rows } = await pool.query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [email.trim().toLowerCase()]
  );
  const row = rows[0];
  return row ? { id: row.id, passwordHash: row.password_hash } : null;
}
