import type {
  User,
  UserPreferences,
  UserQuestionnaire,
  ValueImportance,
  Photo,
  Location,
} from '@match-makers/shared';
import {
  Gender,
  RelationshipGoal,
  SexualOrientation,
  PartnerValue,
  ScheduleType,
  ExerciseLevel,
  SmokingStatus,
  DrinkingStatus,
  PetsPreference,
  PromptTag,
  PromptChoice,
  type PromptAnswer,
} from '@match-makers/shared';
import { MAX_IMPORTANCE, MIN_PROMPTS } from '@match-makers/shared';
import { PROMPTS, type TaggedPrompt } from '@/prompts';
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
    ],
  };
}

/** Picks `count` distinct entries, deterministic for a given PRNG state. */
function pickMany<T>(random: () => number, list: readonly T[], count: number): T[] {
  const remaining = [...list];
  const chosen: T[] = [];
  const take = Math.min(count, remaining.length);
  for (let index = 0; index < take; index += 1) {
    const [picked] = remaining.splice(Math.floor(random() * remaining.length), 1);
    if (picked !== undefined) chosen.push(picked);
  }
  return chosen;
}

const ALL_VALUES = Object.values(PartnerValue);
const ALL_PROMPT_TAGS = Object.values(PromptTag);
const ALL_PROMPT_CHOICES = Object.values(PromptChoice);
const ALL_SCHEDULES = Object.values(ScheduleType);
const ALL_EXERCISE = Object.values(ExerciseLevel);
const ALL_SMOKING = Object.values(SmokingStatus);
const ALL_DRINKING = Object.values(DrinkingStatus);
const ALL_PETS = Object.values(PetsPreference);

/** Draws 2-4 values, including the well-liked ones at their weighted rate. */
function weightedValues(random: () => number): PartnerValue[] {
  const chosen: PartnerValue[] = [];
  for (const value of ALL_VALUES) {
    if (random() < (VALUE_WEIGHTS[value] ?? 0.2)) chosen.push(value);
  }

  const target = 2 + Math.floor(random() * 3);
  if (chosen.length < target) {
    chosen.push(
      ...pickMany(
        random,
        ALL_VALUES.filter((v) => !chosen.includes(v)),
        target - chosen.length
      )
    );
  }
  return chosen.slice(0, target);
}

/**
 * Answers a random subset of the prompts.
 *
 * Every candidate answers at least MIN_PROMPTS so the overlap signal is real,
 * and drawn from the same stream as the rest of the profile so a reseed
 * reshuffles prompt answers along with everything else.
 */
function buildPromptAnswers(random: () => number): PromptAnswer[] {
  const tags = pickMany(random, ALL_PROMPT_TAGS, MIN_PROMPTS + Math.floor(random() * 4));
  return (
    tags
      // The id has to be a real prompt id, otherwise every surface that renders
      // an answer has to fall back to showing a bare tag.
      .map((tag) => PROMPTS.find((prompt) => prompt.tag === tag))
      .filter((definition): definition is TaggedPrompt => definition !== undefined)
      .map((definition) => ({
        promptId: definition.id,
        tag: definition.tag,
        choice: pick(random, ALL_PROMPT_CHOICES),
      }))
  );
}

/**
 * Builds the questionnaire answers the FP3 onboarding collects.
 *
 * Candidates need these so the matching engine has something to compare when
 * it is built; without them every seeded profile is identical on the fields
 * that will eventually drive the score. Grades are assigned from the same
 * random stream as the rest of the user, so a reseed reshuffles the data
 * exactly like it reshuffles the rest of the profile.
 */
/**
 * Shares of seeded candidates that pick each value.
 *
 * Uniform sampling from the eight values made almost nobody agree on
 * anything, which is not what the value of a trait looks like in practice:
 * kindness is the most commonly wanted trait by a wide margin, and the more
 * idiosyncratic ones are rare. Weighting it this way keeps the demo deck
 * legible (a real spread, not everyone scoring the same) and stops a single
 * non-negotiable value from vetoing most of the deck.
 */
const VALUE_WEIGHTS: Record<PartnerValue, number> = {
  [PartnerValue.KINDNESS]: 0.7,
  [PartnerValue.EMOTIONAL_OPENNESS]: 0.5,
  [PartnerValue.SENSE_OF_HUMOUR]: 0.45,
  [PartnerValue.SHARED_INTERESTS]: 0.35,
  [PartnerValue.FAMILY]: 0.25,
  [PartnerValue.AMBITION]: 0.25,
  [PartnerValue.INDEPENDENCE]: 0.2,
  [PartnerValue.PHYSICAL_CLOSENESS]: 0.2,
};

function buildQuestionnaire(random: () => number): UserQuestionnaire {
  const values = weightedValues(random);
  const importance: ValueImportance = {};
  for (const value of values) {
    importance[value] = (1 +
      Math.floor(random() * MAX_IMPORTANCE)) as ValueImportance[PartnerValue];
  }

  // Deal breakers are rare, and when one exists it is the highest graded
  // value, otherwise the pair would contradict the rest of the answer.
  const dealBreakers =
    random() > 0.8
      ? values.filter((value) => importance[value] === MAX_IMPORTANCE).slice(0, 1)
      : [];

  return {
    values,
    importance,
    dealBreakers,
    prompts: buildPromptAnswers(random),
    lifestyle: {
      schedule: pick(random, ALL_SCHEDULES),
      exercise: pick(random, ALL_EXERCISE),
      smoking: pick(random, ALL_SMOKING),
      drinking: pick(random, ALL_DRINKING),
      pets: pick(random, ALL_PETS),
    },
  };
}

/**
 * The demo account's questionnaire, fixed rather than random.
 *
 * It has to be complete because `isProfileComplete` now requires a
 * questionnaire, and RootNavigator only offers the feed once the profile is
 * complete. If this were left blank the demo shortcut would dead-end in
 * onboarding, which is the opposite of what a demo account is for.
 */
function demoQuestionnaire(): UserQuestionnaire {
  const values: PartnerValue[] = [
    PartnerValue.KINDNESS,
    PartnerValue.SENSE_OF_HUMOUR,
    PartnerValue.EMOTIONAL_OPENNESS,
    PartnerValue.SHARED_INTERESTS,
  ];
  return {
    values,
    importance: {
      [PartnerValue.KINDNESS]: 5,
      [PartnerValue.SENSE_OF_HUMOUR]: 4,
      [PartnerValue.EMOTIONAL_OPENNESS]: 5,
      [PartnerValue.SHARED_INTERESTS]: 3,
    },
    // Deliberately no deal breaker. The veto pins a score to 24, and since
    // roughly a third of seeded candidates lack any given value, one on the
    // demo account turns most of the visible deck into the same 24%. The demo
    // exists to show a working spread; the veto is exercised by the tests and
    // by anyone who declares one during onboarding.
    dealBreakers: [],
    prompts: [
      { promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.SOMETIMES },
      { promptId: 'outdoors', tag: PromptTag.LEISURE, choice: PromptChoice.YES },
      { promptId: 'kitchen', tag: PromptTag.FOOD, choice: PromptChoice.YES },
      { promptId: 'playlist', tag: PromptTag.MUSIC, choice: PromptChoice.YES },
      { promptId: 'slow', tag: PromptTag.RECOVERY, choice: PromptChoice.NO },
    ],
    lifestyle: {
      schedule: ScheduleType.FLEXIBLE,
      exercise: ExerciseLevel.MODERATE,
      smoking: SmokingStatus.NEVER,
      drinking: DrinkingStatus.SOCIALLY,
      pets: PetsPreference.LOVE_PETS,
    },
  };
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
    questionnaire: buildQuestionnaire(random),
    isVerified: random() > 0.35,
    createdAt,
    updatedAt: createdAt,
  };
}

export function generateMockUsers(count: number, seed = 42): Array<User & { password: string }> {
  return Array.from({ length: count }, (_, index) => generateMockUser(index + 1, seed));
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
      relationshipGoals: [
        RelationshipGoal.LONG_TERM,
        RelationshipGoal.SHORT_TERM,
        RelationshipGoal.CASUAL,
      ],
    },
    questionnaire: demoQuestionnaire(),
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
