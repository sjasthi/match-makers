export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  NON_BINARY = 'non_binary',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum SexualOrientation {
  STRAIGHT = 'straight',
  GAY = 'gay',
  LESBIAN = 'lesbian',
  BISEXUAL = 'bisexual',
  PANSEXUAL = 'pansexual',
  ASEXUAL = 'asexual',
  QUEER = 'queer',
  OTHER = 'other',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum RelationshipGoal {
  LONG_TERM = 'long_term',
  SHORT_TERM = 'short_term',
  CASUAL = 'casual',
  FRIENDSHIP = 'friendship',
  NOT_SURE = 'not_sure',
}

/** Traits a person says actually matter to them in a partner. */
export enum PartnerValue {
  KINDNESS = 'kindness',
  SENSE_OF_HUMOUR = 'sense_of_humour',
  AMBITION = 'ambition',
  SHARED_INTERESTS = 'shared_interests',
  PHYSICAL_CLOSENESS = 'physical_closeness',
  INDEPENDENCE = 'independence',
  EMOTIONAL_OPENNESS = 'emotional_openness',
  FAMILY = 'family',
}

/**
 * The dimension a prompt measures.
 *
 * A prompt is a real question ("Your ideal weekend looks like...") that
 * carries a tag, so two people who both answered it are answering the same
 * thing. That is what makes the comparison meaningful: an earlier version
 * collected 24 free-floating interest tags and compared them, but almost no
 * two people happened to pick the same set, so the signal never moved off zero.
 */
export enum PromptTag {
  FAMILY = 'family',
  LEISURE = 'leisure',
  FOOD = 'food',
  MUSIC = 'music',
  LEARNING = 'learning',
  TRAVEL = 'travel',
  RECOVERY = 'recovery',
  CHARACTER = 'character',
}

/**
 * The closed set of answers a given prompt accepts.
 *
 * A prompt always offers one of these, which is what makes it scorable. The
 * free-text `note` on `PromptAnswer` is shown to other people as an icebreaker
 * but is never part of the score: there is no defensible way to turn prose
 * into a percentage without a model behind it.
 */
export enum PromptChoice {
  YES = 'yes',
  NO = 'no',
  SOMETIMES = 'sometimes',
  DEPENDS = 'depends',
}

export interface PromptAnswer {
  /** Which question was answered. Stable across releases so stored data holds. */
  promptId: string;
  tag: PromptTag;
  choice: PromptChoice;
  /** Unscoped free text, for other people to read. */
  note?: string;
}

export enum ScheduleType {
  EARLY_BIRD = 'early_bird',
  NIGHT_OWL = 'night_owl',
  FLEXIBLE = 'flexible',
}

export enum ExerciseLevel {
  NONE = 'none',
  LIGHT = 'light',
  MODERATE = 'moderate',
  A_LOT = 'a_lot',
}

export enum KidsPreference {
  WANT_KIDS = 'want_kids',
  HAVE_KIDS = 'have_kids',
  DO_NOT_WANT_KIDS = 'do_not_want_kids',
  OPEN = 'open',
}

export enum SmokingStatus {
  NEVER = 'never',
  SOCIALLY = 'socially',
  DAILY = 'daily',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum DrinkingStatus {
  NEVER = 'never',
  SOCIALLY = 'socially',
  OFTEN = 'often',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum PetsPreference {
  LOVE_PETS = 'love_pets',
  HAVE_PETS = 'have_pets',
  ALLERGIC = 'allergic',
  NO_PREFERENCE = 'no_preference',
}

export interface LifestyleAnswers {
  schedule: ScheduleType;
  exercise: ExerciseLevel;
  smoking: SmokingStatus;
  drinking: DrinkingStatus;
  pets: PetsPreference;
}

/**
 * How much a value matters. The numbers are the weight the future matching
 * engine will read, so they are stored rather than recomputed from an ordinal.
 */
export enum ImportanceScale {
  NICE_TO_HAVE = 1,
  FAIRLY_IMPORTANT = 2,
  IMPORTANT = 3,
  VERY_IMPORTANT = 4,
  NON_NEGOTIABLE = 5,
}

export const MIN_IMPORTANCE = ImportanceScale.NICE_TO_HAVE;
export const MAX_IMPORTANCE = ImportanceScale.NON_NEGOTIABLE;

export type ValueImportance = Partial<Record<PartnerValue, ImportanceScale>>;

/**
 * The FP3 questionnaire answers.
 *
 * This is what the matching engine scores, and `scoreCompatibility` in the
 * mobile app reads every field of it. The schema lives in shared so the backend
 * reads the same definitions the app already validates against.
 */
export interface UserQuestionnaire {
  values: PartnerValue[];
  /** Required for every entry in `values`; that is what makes it a weight. */
  importance: ValueImportance;
  /** A `values` entry the other person should never have picked. Acts as a veto, not a deduction. */
  dealBreakers: PartnerValue[];
  /** Tagged prompt answers. Compared on shared tags, so see `PromptTag`. */
  prompts: PromptAnswer[];
  lifestyle: LifestyleAnswers;
}

export interface User {
  id: string;
  email: string;
  name: string;
  dateOfBirth: string; // ISO date string
  gender: Gender;
  sexualOrientation: SexualOrientation;
  relationshipGoal: RelationshipGoal;
  bio: string;
  photos: Photo[];
  location: Location;
  preferences: UserPreferences;
  /**
   * Absent until the questionnaire is finished, which is what keeps a new
   * account in onboarding instead of dropping straight into the feed.
   */
  questionnaire?: UserQuestionnaire;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Photo {
  id: string;
  url: string;
  isPrimary: boolean;
  order: number;
}

export interface Location {
  latitude: number;
  longitude: number;
  city: string;
  country: string;
}

/**
 * How far the discovery feed is willing to look.
 *
 * A discriminated mode rather than a nullable radius, because "no limit" and
 * "50 km" are different questions and the UI asks them as a pair. Making the
 * radius nullable would push a `?? 50` at every read site, and a sentinel like
 * `0` reads as a bug rather than an instruction.
 */
export type DistanceMode = 'nearby' | 'global';

export interface UserPreferences {
  ageRange: { min: number; max: number };
  /** `global` ignores `maxDistance` entirely. */
  distanceMode: DistanceMode;
  /**
   * Kilometres, consulted only when `distanceMode` is `nearby`.
   *
   * Kept populated in `global` mode on purpose: switching back to `nearby`
   * restores the radius you had before rather than resetting it, and a number
   * that means nothing while `global` costs nothing to carry.
   */
  maxDistance: number;
  genders: Gender[];
  relationshipGoals: RelationshipGoal[];
}

/**
 * Everything the FP3 account-creation questionnaire collects, in one shape.
 *
 * The app saves each section as it is completed rather than posting this whole
 * object at the end, but the backend needs it as the contract for a single
 * setup call. Replaces the old `ProfileSetupData`, which referenced a browser
 * `File` and so could never have been satisfied from React Native.
 */
export interface ProfileSetupPayload {
  name: string;
  dateOfBirth: string;
  gender: Gender;
  sexualOrientation: SexualOrientation;
  relationshipGoal: RelationshipGoal;
  bio: string;
  photos: Photo[];
  location: Location;
  preferences: UserPreferences;
  questionnaire: UserQuestionnaire;
}

export interface SwipeAction {
  type: 'like' | 'pass' | 'super_like';
  targetUserId: string;
}

export interface Match {
  id: string;
  users: [User, User];
  createdAt: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'system';
  createdAt: string;
  readAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult {
  user: User;
  tokens?: AuthTokens;
  sessionId?: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  dateOfBirth: string;
  gender: Gender;
}
