import {
  Gender,
  RelationshipGoal,
  type DistanceMode,
  type Location,
  type Post,
  type PostReaction,
  type UserPreferences,
  normaliseTag,
} from '@match-makers/shared';
import { TAG_MAX_LENGTH, MAX_POST_TAGS } from '@match-makers/shared';
import { findCityCentroid } from '@/utils/cityCatalog';
import { hasCoordinates } from '@/utils/distance';
import { APP_CONFIG } from '@/constants';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const GENDERS = new Set<string>(Object.values(Gender));
const RELATIONSHIP_GOALS = new Set<string>(Object.values(RelationshipGoal));
const DISTANCE_MODES = new Set<string>(['nearby', 'global']);

const MIN_DISTANCE = 1;
const MAX_DISTANCE = APP_CONFIG.MAX_DISTANCE;

export function normalisePreferences(raw: unknown): UserPreferences {
  const source = isRecord(raw) ? raw : {};

  const distanceMode =
    typeof source.distanceMode === 'string' && DISTANCE_MODES.has(source.distanceMode)
      ? (source.distanceMode as DistanceMode)
      : 'nearby';

  const ageRange = isRecord(source.ageRange) ? source.ageRange : {};
  const min = clampNumber(ageRange.min, APP_CONFIG.MIN_AGE, APP_CONFIG.MIN_AGE, APP_CONFIG.MAX_AGE);
  const max = clampNumber(ageRange.max, 38, APP_CONFIG.MIN_AGE + 1, APP_CONFIG.MAX_AGE);

  return {
    // Held coherent rather than left inverted, since the schema rejects
    // `min >= max` and a normalised record that its own schema rejects is not
    // an upgrade.
    ageRange: { min: Math.min(min, max - 1), max: Math.max(max, min + 1) },
    distanceMode,
    maxDistance: clampNumber(source.maxDistance, 50, MIN_DISTANCE, MAX_DISTANCE),
    genders: asArray(source.genders).filter(
      (value): value is Gender => typeof value === 'string' && GENDERS.has(value)
    ),
    relationshipGoals: asArray(source.relationshipGoals).filter(
      (value): value is RelationshipGoal =>
        typeof value === 'string' && RELATIONSHIP_GOALS.has(value)
    ),
  };
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

/**
 * Gives a stored location measurable coordinates where we can.
 *
 * Records are read from a JSON blob that predates the distance rules, so a large
 * share of them carry the `0, 0` placeholder: a hand-typed city, or an account
 * registered before onboarding collected coordinates. Left alone they would be
 * invisible in every nearby deck, because a profile at 0,0 is roughly 10,000 km
 * from everyone and the filter would be behaving correctly.
 *
 * The city label is resolved against the catalog rather than discarded. That is
 * a guess -- a centroid, not a home address -- but it is a guess in the
 * direction of showing someone their deck rather than an empty screen, and the
 * alternative is that upgrading the database quietly empties everyone's feed.
 *
 * A city we cannot resolve is left as `0, 0` rather than invented, and stays
 * hidden from nearby viewers while remaining reachable on global.
 */
export function normaliseLocation(raw: unknown): Location {
  const source = isRecord(raw) ? raw : {};

  const city = typeof source.city === 'string' ? source.city : '';
  const country = typeof source.country === 'string' ? source.country : '';

  const latitude = typeof source.latitude === 'number' ? source.latitude : Number.NaN;
  const longitude = typeof source.longitude === 'number' ? source.longitude : Number.NaN;

  const candidate: Location = { latitude, longitude, city, country };
  if (hasCoordinates(candidate)) return candidate;

  const centroid = findCityCentroid(city, country);
  if (!centroid) return { latitude: 0, longitude: 0, city, country };

  return { latitude: centroid.latitude, longitude: centroid.longitude, city, country };
}

/** Normalises every user in a stored mock state, reporting whether anything moved. */
export function normaliseStateUsers(users: unknown): { users: unknown[]; changed: boolean } {
  if (!Array.isArray(users)) return { users: [], changed: true };

  let changed = false;
  const next = users.map((user) => {
    if (!isRecord(user)) {
      changed = true;
      return user;
    }

    const preferences = normalisePreferences(user.preferences);
    const location = normaliseLocation(user.location);

    const untouched =
      JSON.stringify(preferences) === JSON.stringify(user.preferences) &&
      JSON.stringify(location) === JSON.stringify(user.location);

    if (untouched) return user;

    changed = true;
    return { ...user, preferences, location };
  });

  return { users: next, changed };
}

/**
 * A questionnaire may still be on a record written before FP4. It is left there.
 *
 * Nothing reads it any more — the photo feed replaced it as the matching signal —
 * but deleting it would mean a migration that throws away a field some older
 * record may still carry, for no gain. Tolerating an unknown key is free; the
 * alternative is a migration that can fail on data nobody reads.
 *
 * Brings a whole stored mock state up to the current shape.
 *
 * The collections added after the first release (`posts`, `postReactions`) are
 * defaulted to empty rather than triggering a reseed. That distinction matters:
 * reseeding is what throws away every account, swipe and message a person has,
 * and the collections are append-only from here, so an account that predates the
 * photo feed loses its feed history and nothing else. A user who has not seen
 * the feed yet has, by definition, no feed history to lose.
 *
 * Posts are dropped rather than repaired if they carry no tags. A post with no
 * tags cannot be matched on and cannot be rendered, so keeping it would push the
 * failure into the feed, where it would look like the matcher being broken
 * rather than like a record written by an older build.
 */
export function normaliseState(state: unknown): { state: unknown; changed: boolean } {
  if (!isRecord(state)) return { state, changed: true };

  const { users, changed: usersChanged } = normaliseStateUsers(state.users);
  const posts = normalisePosts(state.posts);
  const postReactions = normalisePostReactions(state.postReactions, posts);

  const collectionsChanged =
    !Array.isArray(state.posts) || !Array.isArray(state.postReactions);

  return {
    state: {
      ...state,
      users,
      posts,
      postReactions,
    },
    changed: usersChanged || collectionsChanged,
  };
}

/**
 * Normalises a post's free-text tags, in the order the admin typed them.
 *
 * Order is preserved because the first tag is the primary one, so de-duplicating
 * has to keep the *earliest* occurrence rather than the last: a post tagged
 * `dog, cat, dog` has `dog` as its subject, and dropping the second `dog` keeps
 * that right. A `Set` would have kept the first too, but doing it by hand makes
 * the ordering deliberate rather than incidental.
 *
 * Tags are folded to their canonical form here for the same reason the schema
 * folds them: a record written by an older build, or one that skipped the
 * importer, should not be able to hold `Dogs` next to `dog` and quietly split a
 * pair that the admin believes is joined up.
 */
function normaliseTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  const seen = new Set<string>();
  const next: string[] = [];

  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    if (raw.length > TAG_MAX_LENGTH) continue;

    const tag = normaliseTag(raw);
    if (!tag || seen.has(tag)) continue;

    seen.add(tag);
    next.push(tag);
    if (next.length === MAX_POST_TAGS) break;
  }

  return next;
}

function normalisePosts(posts: unknown): Post[] {
  if (!Array.isArray(posts)) return [];

  return posts.flatMap((post) => {
    if (!isRecord(post)) return [];
    if (typeof post.id !== 'string' || typeof post.imageUri !== 'string') return [];

    const tags = normaliseTags(post.tags);

    // A post with no usable tag can neither be rendered nor scored on, so it is
    // dropped rather than surfaced. Under the old closed set this also caught
    // tags the current build did not know; with free text the only way to get
    // here is a record written with an empty or missing tag list.
    if (tags.length === 0) return [];

    return [
      {
        id: post.id,
        imageUri: post.imageUri,
        // Carried only when the record actually has them. A post written before
        // the importer produced two copies normalises to no thumb at all, and the
        // grid falls back to the full image for it. Deriving one here instead
        // would rewrite every stored photo on load, which is the behaviour this
        // function exists to avoid.
        ...(typeof post.thumbUri === 'string' && post.thumbUri ? { thumbUri: post.thumbUri } : {}),
        ...(typeof post.width === 'number' && post.width > 0 ? { width: post.width } : {}),
        ...(typeof post.height === 'number' && post.height > 0 ? { height: post.height } : {}),
        tags,
        createdAt: typeof post.createdAt === 'string' ? post.createdAt : new Date(0).toISOString(),
      },
    ];
  });
}

function normalisePostReactions(reactions: unknown, posts: Post[]): PostReaction[] {
  if (!Array.isArray(reactions)) return [];
  const postIds = new Set(posts.map((post) => post.id));

  return reactions.flatMap((reaction) => {
    if (!isRecord(reaction)) return [];
    if (typeof reaction.id !== 'string' || typeof reaction.userId !== 'string') return [];
    if (typeof reaction.postId !== 'string' || !postIds.has(reaction.postId)) return [];
    if (reaction.action !== 'like' && reaction.action !== 'dislike') return [];

    return [
      {
        id: reaction.id,
        userId: reaction.userId,
        postId: reaction.postId,
        action: reaction.action,
        createdAt:
          typeof reaction.createdAt === 'string' ? reaction.createdAt : new Date(0).toISOString(),
      },
    ];
  });
}
