import type {
  User,
  UserPreferences,
  Photo,
  Location,
  Post,
  PostReaction,
  PostReactionAction,
} from '@match-makers/shared';
import { Gender, RelationshipGoal, SexualOrientation } from '@match-makers/shared';
import { APP_CONFIG } from '@/constants';
import { findCityCentroid } from '@/utils/cityCatalog';
import { destinationPoint } from '@/utils/distance';

export const DEMO_EMAIL = 'demo@matchmakers.dev';
export const DEMO_PASSWORD = 'Password1';

const FIRST_NAMES = [
  'Amara',
  'Jonas',
  'Priya',
  'Mateo',
  'Zara',
  'Ellis',
  'Nadia',
  'Rowan',
  'Kenji',
  'Lucia',
  'Tobias',
  'Amina',
  'Rafael',
  'Sinead',
  'Hana',
  'Dmitri',
  'Noor',
  'Felix',
  'Ines',
  'Omar',
  'Thandi',
  'Lars',
  'Yuki',
  'Chiara',
];

const LAST_NAMES = [
  'Okafor',
  'Lindqvist',
  'Raman',
  'Alvarez',
  'Haddad',
  'Whitmore',
  'Kovacs',
  'Bennett',
  'Tanaka',
  'Moreau',
  'Sorensen',
  'Diallo',
  'Ferreira',
  'Byrne',
  'Sato',
  'Volkov',
  'Rahman',
  'Baumann',
  'Costa',
  'Haddadi',
  'Mokoena',
  'Eriksen',
  'Watanabe',
  'Rossi',
];

/**
 * Where the seeded candidates live, as tiers rather than as one flat list.
 *
 * This replaced a single `CITIES` array paired with a uniformly random
 * latitude and longitude, which was the reason a distance filter could not be
 * switched on: the coordinates were drawn from the whole globe and attached to
 * whichever city label the same PRNG happened to produce, so a profile called
 * "Austin" could sit at latitude -70. Any correct distance calculation against
 * that seed returns an empty deck, which is indistinguishable from a broken
 * filter.
 *
 * Three tiers, so the nearby/global split is something you can see rather than
 * something the code merely claims to support. The demo account is in Austin on
 * a 50 km radius, so it should land on a deck full of nearby people by default
 * and a visibly larger one after switching to global.
 */
interface SeedTier {
  /** City names to draw from. Every one is present in `CITY_CENTROIDS`. */
  cities: readonly string[];
  /** Radius to scatter within, in km. Equal values means "sit on the centroid". */
  minKm: number;
  maxKm: number;
}

/** Inside the demo account's 50 km radius, so these are the deck you get. */
const NEAR_HOME: SeedTier = { cities: ['Austin'], minKm: 2, maxKm: 45 };

/** Close enough to be plausible, far enough to be filtered out by 50 km. */
const SAME_REGION: SeedTier = {
  cities: ['San Antonio', 'Houston', 'Dallas'],
  minKm: 90,
  maxKm: 320,
};

/** Only reachable by switching to global. */
const WORLDWIDE: SeedTier = {
  cities: [
    'Toronto',
    'Lisbon',
    'Melbourne',
    'Nairobi',
    'Rotterdam',
    'Singapore',
    'Bogota',
    'Amsterdam',
  ],
  minKm: 0,
  maxKm: 0,
};

/**
 * Which tier a candidate belongs to.
 *
 * Weighted towards nearby, because that is roughly what a real dating pool
 * looks like and because the demo deck has to be worth swiping through. Drawn
 * from the same stream as everything else on the profile, so reseeding
 * redistributes locations along with names and prompt answers.
 */
function seedTier(random: () => number): SeedTier {
  const draw = random();
  if (draw < 0.6) return NEAR_HOME;
  if (draw < 0.8) return SAME_REGION;
  return WORLDWIDE;
}

/**
 * A location for a seeded candidate: its city centroid, scattered by a known
 * distance.
 *
 * Scattering goes through `destinationPoint` rather than adding degrees to the
 * latitude, so "30 km from Austin" is genuinely 30 km from Austin. Off the
 * centre is a real thing people do, and a profile whose stored coordinates
 * disagree with its city label is the exact bug this replaced.
 *
 * The city label is carried through the scatter rather than re-derived, because
 * nobody 30 km from downtown Austin lives in a different city.
 */
function seedLocation(random: () => number, tier: SeedTier): Location {
  const city = pick(random, tier.cities);
  const centroid = findCityCentroid(city);
  if (!centroid) {
    // Every tier city is in the catalog. Throwing here rather than falling back
    // to 0,0 is deliberate: a silently mislabelled coordinate is what made the
    // distance rules untestable in the first place.
    throw new Error(`Seed city "${city}" is missing from CITY_CENTROIDS`);
  }

  if (tier.minKm === tier.maxKm) return centroid;

  const spread = tier.minKm + random() * (tier.maxKm - tier.minKm);
  return destinationPoint(centroid, random() * 360, spread);
}

const INTERESTS = [
  'bouldering',
  'film photography',
  'sourdough baking',
  'open water swimming',
  'jazz records',
  'urban gardening',
  'trail running',
  'board game nights',
  'cooking with strangers',
  'pottery',
  'cycling',
  'live music',
  'reading',
  'hiking',
  'sea kayaking',
  'karaoke',
  'museums',
  'cold water dips',
];

const BIO_TEMPLATES = [
  'Will absolutely talk your ear off about {a}. Looking for someone to {b} with on a weeknight.',
  '{a} on weekends. Currently trying to get better at {b}. Ask me about my last food disaster.',
  'Big fan of {a}, new to {b} and unreasonably excited about it.',
  'Trying to be the person who is good at {b}. Currently failing at it, but with enthusiasm.',
  'Two things I will always talk about: {a} and why {b} is overrated. Change my mind.',
  'Just moved here and looking for people to explore with. Big fan of {a} and {b}.',
];

const BIOS = [
  'Climbing gym regular, will absolutely drag you to a new bouldering problem.',
  'I make a dangerously good risotto and I have the receipts.',
  'Third week of learning to surf. Send help. Also send a good sandwich.',
  'Ex-lawyer, current full-time reader. Still argue in my head.',
  'I have 43 houseplants and no regrets. Come over and pick a favourite.',
  'Chasing good espresso and slow mornings. Big fan of live jazz.',
  'I run before the sun comes up so I can complain about it in peace.',
  'Building a small bookshelf empire, one cracked paperback at a time.',
];

function createId(prefix: string, index: number): string {
  return `${prefix}_${index.toString().padStart(4, '0')}`;
}

/** Deterministic PRNG so the mock feed is stable across reloads. */
function createRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function pick<T>(random: () => number, list: readonly T[]): T {
  const index = Math.floor(random() * list.length);
  // noUncheckedIndexedAccess: the modulo above guarantees a valid index.
  return list[index] as T;
}

/**
 * Builds a user's placeholder photo.
 *
 * The `url` is deliberately empty: the mock backend does not host image files,
 * and an empty url tells `ProfileImage` to draw a generated initials avatar
 * instead of fetching anything. The real backend will always supply a real url
 * here, so this convention never leaves the prototype.
 *
 * Exactly one photo per seeded user. An earlier version generated 1-3 photos
 * that all resolved to the same remote image, so a user with several photos
 * displayed the same picture repeated.
 */
function buildPhotos(seed: string): Photo[] {
  return [
    {
      // Scoped by the user seed, otherwise every profile shares photo_0001.
      id: `photo_${seed}_1`,
      url: '',
      isPrimary: true,
      order: 0,
    },
  ];
}

function buildBio(random: () => number): string {
  const template = pick(random, BIO_TEMPLATES);
  const [firstInterest, secondInterest] = [pick(random, INTERESTS), pick(random, INTERESTS)];
  return template.replace('{a}', firstInterest).replace('{b}', secondInterest);
}

/**
 * Preferences for a seeded candidate, deliberately permissive.
 *
 * Matching is mutual: the deck is what both people' requirements allow, not just
 * the viewer's. If seeded candidates were handed the same 25-75 km radius and
 * narrow age range the demo account has, their limits would bind first and the
 * demo would appear to prove nothing about the viewer's own settings.
 *
 * So candidates are set to accept anyone, and `distanceMode` is global rather
 * than nearby: the viewer becomes the only constrained side, which is what
 * makes toggling Nearby/Global on their own profile visibly change the deck.
 * The mutual rejection path is exercised by the eligibility tests instead, the
 * same way the demo questionnaire carries no deal breaker for exactly this
 * reason (`demoQuestionnaire`).
 */
function defaultPreferences(): UserPreferences {
  return {
    ageRange: { min: APP_CONFIG.MIN_AGE, max: APP_CONFIG.MAX_AGE },
    distanceMode: 'global',
    maxDistance: APP_CONFIG.MAX_DISTANCE,
    genders: [Gender.FEMALE, Gender.MALE, Gender.NON_BINARY],
    relationshipGoals: [
      RelationshipGoal.LONG_TERM,
      RelationshipGoal.SHORT_TERM,
      RelationshipGoal.CASUAL,
      RelationshipGoal.FRIENDSHIP,
      RelationshipGoal.NOT_SURE,
    ],
  };
}

export function generateMockUser(index: number, seed = 42): User & { password: string } {
  const random = createRandom(seed + index * 7919);
  const firstName = pick(random, FIRST_NAMES);
  const lastName = pick(random, LAST_NAMES);
  const gender = pick(random, [Gender.FEMALE, Gender.MALE, Gender.NON_BINARY]);

  const birthYear = 1990 + Math.floor(random() * 14);
  const birthMonth = 1 + Math.floor(random() * 12);
  const birthDay = 1 + Math.floor(random() * 28);
  const dateOfBirth = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;

  const createdAt = new Date(Date.now() - Math.floor(random() * 400) * 86_400_000).toISOString();

  return {
    id: createId('user', index),
    email: `candidate${index}@matchmakers.dev`,
    password: 'Password1',
    name: `${firstName} ${lastName}`,
    dateOfBirth,
    gender,
    sexualOrientation: pick(random, [
      SexualOrientation.STRAIGHT,
      SexualOrientation.BISEXUAL,
      SexualOrientation.GAY,
      SexualOrientation.LESBIAN,
      SexualOrientation.QUEER,
    ]),
    relationshipGoal: pick(random, [
      RelationshipGoal.LONG_TERM,
      RelationshipGoal.SHORT_TERM,
      RelationshipGoal.CASUAL,
      RelationshipGoal.FRIENDSHIP,
    ]),
    bio: random() > 0.4 ? buildBio(random) : pick(random, BIOS),
    photos: buildPhotos(String(index)),
    location: seedLocation(random, seedTier(random)),
    preferences: defaultPreferences(),
    isVerified: random() > 0.35,
    createdAt,
    updatedAt: createdAt,
  };
}

export function generateMockUsers(count: number, seed = 42): Array<User & { password: string }> {
  return Array.from({ length: count }, (_, index) => generateMockUser(index + 1, seed));
}

export function ageFromDateOfBirth(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

/* -------------------------------------------------------------------------- */
/* Photo feed seed (FP4)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Weighted so the seed library has a recognisable shape.
 *
 * The feed is a taste signal, and the interest it reads is only interesting if
 * the population disagrees about some things and agrees about others. Uniform
 * tags would make every pair overlap by chance and the affinity score would sit
 * in a narrow band for everyone. `animal` is the heaviest because it is the
 * clearest case of the feature working: two strangers liking two different animal
 * photos have still found each other.
 *
 * These are ordinary words, not enum members, because tags are free text now.
 * They are written in the canonical form `normaliseTag` produces, so a seed tag
 * and a typed one compare equal without any of this needing to be folded again:
 * `pets` and `animals` would become `pet` and `animal`, which is what makes
 * `animals` and `animal` interchangeable everywhere.
 *
 * Nothing stops an admin typing `hiking` or `baking` or `sourdough`, and the
 * import screen suggests whatever is already here so the vocabulary converges
 * rather than fracturing.
 */
const TAG_WEIGHTS: Array<{ tag: string; weight: number }> = [
  { tag: 'animal', weight: 0.2 },
  { tag: 'pet', weight: 0.16 },
  { tag: 'outdoor', weight: 0.15 },
  { tag: 'food', weight: 0.14 },
  { tag: 'travel', weight: 0.12 },
  { tag: 'music', weight: 0.09 },
  { tag: 'art', weight: 0.06 },
  { tag: 'home', weight: 0.04 },
  { tag: 'fitness', weight: 0.03 },
  { tag: 'nightlife', weight: 0.01 },
];

const POST_SEED = 7;

/** Picks one tag from the weighted table. */
function weightedTag(random: () => number): string {
  const roll = random();
  let cumulative = 0;
  for (const entry of TAG_WEIGHTS) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.tag;
  }
  // The weights sum to 1, so this is only reachable by floating point drift.
  return 'animal';
}

/**
 * The site-owned photo library on a fresh install.
 *
 * Every `imageUri` is empty, exactly like a seeded profile's photo. That is
 * deliberate and it is not a placeholder for something unfinished: the prototype
 * ships no photographs, so the feed renders a generated tile keyed to the
 * primary tag. An admin import replaces those tiles with real images, which is
 * how the library is meant to be filled.
 */
export function generateSeedPosts(count: number, seed = POST_SEED): Post[] {
  const random = createRandom(seed);
  // Fixed timestamp rather than `now`, so a reseed does not make every seeded
  // post look newly added.
  const createdAt = '2026-01-01T00:00:00.000Z';

  return Array.from({ length: count }, (_, index) => {
    const primary = weightedTag(random);

    // A secondary tag is only ever added when it is not the primary one, and
    // never with more than one, so the "first tag is primary" rule in `Post`
    // holds and a second tag stays a genuine hint rather than a co-equal claim.
    const others = TAG_WEIGHTS.map((entry) => entry.tag).filter((tag) => tag !== primary);
    const secondary = random() > 0.72 ? pick(random, others) : null;

    return {
      id: createId('post', index + 1),
      imageUri: '',
      tags: secondary ? [primary, secondary] : [primary],
      createdAt,
    };
  });
}

/**
 * Seeded reactions, so the taste signal has somebody to be about before the
 * tester has touched anything.
 *
 * Seeded per user rather than globally, and the picks overlap by chance rather
 * than by design: a real population disagrees about most things and agrees about
 * a few, and a seed where everybody likes the same five photos would make the
 * affinity score meaningless.
 *
 * Callers pass the seeded candidates, never the demo account. See the note in
 * `createInitialState`.
 */
export function seedReactionsFor(users: User[], posts: Post[], seed = 913): PostReaction[] {
  if (posts.length === 0 || users.length === 0) return [];

  const reactions: PostReaction[] = [];
  const createdAt = '2026-01-01T00:00:00.000Z';

  for (const user of users) {
    const random = createRandom(seed + hashId(user.id));
    // Between four and fourteen. Enough to clear the confidence damping, low
    // enough that a seeded user is not nearly compatible with the whole seed.
    const count = 4 + Math.floor(random() * 11);

    for (let index = 0; index < count; index += 1) {
      const post = posts[Math.floor(random() * posts.length)];
      if (!post) continue;

      // One in six is a dislike. Dislikes steer the feed and nothing else, so
      // they exist to prove that they never become shared evidence.
      const action: PostReactionAction = random() > 0.84 ? 'dislike' : 'like';

      reactions.push({
        id: `reaction_${user.id}_${post.id}`,
        userId: user.id,
        postId: post.id,
        action,
        createdAt,
      });
    }
  }

  // Two people can land on the same post, and the upsert path would normally
  // collapse that to one row. Seeded reactions are written directly, so drop
  // the duplicates here rather than letting a double-counted like inflate a
  // pair's evidence.
  const unique = new Map<string, PostReaction>();
  for (const reaction of reactions) {
    unique.set(`${reaction.userId}:${reaction.postId}`, reaction);
  }
  return [...unique.values()];
}

/** Small stable hash so every user id gets its own reaction stream. */
function hashId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * The account you can sign into immediately to explore the prototype.
 *
 * `nearby` at 50 km from Austin is the default because it is the interesting
 * case: it is a real limit that the seed is built to partly satisfy, so
 * switching to `global` in preferences changes the size of the deck for a
 * reason the tester can see.
 */
export function generateDemoUser(): User & { password: string } {
  return {
    id: 'user_demo',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    name: 'Demo User',
    dateOfBirth: '1995-06-15',
    gender: Gender.PREFER_NOT_TO_SAY,
    sexualOrientation: SexualOrientation.PREFER_NOT_TO_SAY,
    relationshipGoal: RelationshipGoal.NOT_SURE,
    bio: 'This is the demo account. Edit this bio, add photos, and go swipe.',
    photos: buildPhotos('demo'),
    location: { latitude: 30.2672, longitude: -97.7431, city: 'Austin', country: 'United States' },
    preferences: {
      ageRange: { min: 24, max: 38 },
      distanceMode: 'nearby',
      maxDistance: 50,
      genders: [Gender.FEMALE, Gender.MALE, Gender.NON_BINARY],
      // Every goal a seeded candidate can be assigned. `friendship` was missing
      // from this list while candidates are still assigned it, so the demo
      // account excluded roughly a quarter of the pool through its own gate,
      // with nothing anywhere on screen to say so.
      relationshipGoals: [
        RelationshipGoal.LONG_TERM,
        RelationshipGoal.SHORT_TERM,
        RelationshipGoal.CASUAL,
        RelationshipGoal.FRIENDSHIP,
        RelationshipGoal.NOT_SURE,
      ],
    },
    isVerified: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function generateConversationOpeners(): string[] {
  return [
    'Okay, your bouldering gym take needs defending.',
    'Two weeks in and I still cannot tell if this was a good idea.',
    'Best cup of coffee I have had all year, and I am including yours.',
    'You said you like live music. I may have a spare ticket.',
  ];
}
