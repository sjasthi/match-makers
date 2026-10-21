import type {
  DistanceMode,
  Gender,
  Location,
  Photo,
  Post,
  PostVariant,
  RelationshipGoal,
  SexualOrientation,
  User,
  UserPreferences,
} from '@match-makers/shared';

/**
 * Row shapes, and the mapping to the shared domain types.
 *
 * Postgres columns are snake_case and the domain model is camelCase. The two
 * are kept apart deliberately rather than letting `pg` return snake_case rows
 * typed as `User` -- that cast compiles and then lies at runtime, in exactly
 * the places (`photos`, `preferences`, `location`) where the shape actually
 * differs.
 *
 * Every mapping is explicit so that a column rename fails the typecheck here
 * instead of silently producing `undefined` in a response.
 */

/** Mirrors the `users` table. `password_hash` is deliberately absent. */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  date_of_birth: string;
  gender: Gender;
  sexual_orientation: SexualOrientation;
  relationship_goal: RelationshipGoal;
  bio: string;
  latitude: number | null;
  longitude: number | null;
  city: string;
  country: string;
  is_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserPreferencesRow {
  user_id: string;
  age_min: number;
  age_max: number;
  distance_mode: DistanceMode;
  max_distance: number;
  genders: Gender[];
  relationship_goals: RelationshipGoal[];
}

export interface PhotoRow {
  id: string;
  user_id: string;
  url: string;
  is_primary: boolean;
  position: number;
}

export interface PostRow {
  id: string;
  image_uri: string;
  thumb_uri: string | null;
  width: number | null;
  height: number | null;
  tags: string[];
  created_at: Date;
}

/**
 * `date` columns come back as `YYYY-MM-DD`, which is what `User.dateOfBirth`
 * already is. Passed through untouched -- `pg` parses `date` as a string
 * precisely because a local-midnight Date would shift the day for anyone west
 * of UTC.
 */
function toLocation(row: Pick<UserRow, 'latitude' | 'longitude' | 'city' | 'country'>): Location {
  // Matches `normaliseLocation` in the mock, which treats 0,0 as "unset" rather
  // than as a point in the Atlantic.
  const hasCoordinates = row.latitude !== null && row.longitude !== null;
  return {
    latitude: hasCoordinates ? (row.latitude as number) : 0,
    longitude: hasCoordinates ? (row.longitude as number) : 0,
    city: row.city,
    country: row.country,
  };
}

export function toPreferences(row: UserPreferencesRow): UserPreferences {
  return {
    ageRange: { min: row.age_min, max: row.age_max },
    distanceMode: row.distance_mode,
    maxDistance: row.max_distance,
    genders: row.genders,
    relationshipGoals: row.relationship_goals,
  };
}

export function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    url: row.url,
    isPrimary: row.is_primary,
    order: row.position,
  };
}

/**
 * Assemble the domain `User` from its three sources.
 *
 * The mock had all three inside one record, so a read was `findUserById`. Here
 * it is three queries, and `loadUser` in `db/users.ts` runs them together.
 */
export function toUser(row: UserRow, photos: Photo[], preferences: UserPreferences | null): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    sexualOrientation: row.sexual_orientation,
    relationshipGoal: row.relationship_goal,
    bio: row.bio,
    photos,
    location: toLocation(row),
    // A profile with no preferences row yet -- possible, because onboarding
    // writes the user before it writes the preferences. The defaults here match
    // `MockAuthAdapter.register`.
    preferences: preferences ?? {
      ageRange: { min: 24, max: 38 },
      distanceMode: 'nearby',
      maxDistance: 50,
      genders: [],
      relationshipGoals: [],
    },
    isVerified: row.is_verified,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toPost(row: PostRow, variants: PostVariant[] = []): Post {
  return {
    id: row.id,
    imageUri: row.image_uri,
    // `thumbUri` is optional on the type and absent is meaningful, so a NULL
    // column has to stay absent rather than becoming an empty string.
    ...(row.thumb_uri !== null ? { thumbUri: row.thumb_uri } : {}),
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
    // The rendition ladder, widest first. Empty for a post that has no ladder,
    // which is every post written before this existed -- the client falls back
    // to `imageUri`, which is the largest rendition anyway.
    ...(variants.length > 0 ? { variants } : {}),
    tags: row.tags,
    createdAt: row.created_at.toISOString(),
  };
}
