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

/*
 * The FP3 questionnaire (`UserQuestionnaire`, `PartnerValue`, `PromptTag`,
 * `PromptChoice`, `ImportanceScale`, `LifestyleAnswers` and friends) was removed
 * here. It was a third of the match score and the only stated evidence of what
 * somebody wanted in a partner; the photo feed replaced it, and
 * `User.preferences` became a hard gate rather than a set of scoring signals.
 *
 * Stored records written before this may still carry a `questionnaire` key.
 * Nothing reads it - see `services/mock/migrate.ts` - and it is left in place
 * rather than deleted, because wiping real user data that is not causing a
 * problem is not worth the migration risk.
 */
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
 * Everything account creation collects, in one shape.
 *
 * The app saves each section as it is completed rather than posting this whole
 * object at the end, but the backend needs it as the contract for a single
 * setup call. The questionnaire that used to be the last field is gone; what it
 * used to tell the matcher about somebody now comes from the photos they answer.
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
}

/* -------------------------------------------------------------------------- */
/* Photo feed (FP4)                                                            */
/* -------------------------------------------------------------------------- */

/*
 * There was an `InterestTag` enum here: a closed set of ten subjects, on the
 * argument that the matcher has to compare two people and free text gives it
 * nothing to compare. It was removed because a ten-word vocabulary is a real
 * limit on what a photo library can say, and the comparison problem is better
 * solved by folding spelling than by forbidding words.
 *
 * `Post.tags` is now `string[]`. The guard rails that replaced the enum live in
 * `apps/shared/src/tags.ts`: `normaliseTag` folds case, spacing and plurals, and
 * `postTagSchema` caps length and count. Do not reintroduce a closed set without
 * re-reading `fp_reviews.md`, which argues the other way on purpose.
 */

/**
 * One photo in the site-owned library, with no author.
 *
 * Posts belong to the platform, not to a profile. They are not a social feature:
 * the feed is an input device for working out what somebody likes, and the
 * matching that comes out of it happens between people rather than between a
 * person and whoever posted the picture. That is why there is no `userId` here
 * and why a post cannot be matched to an author.
 */
export interface Post {
  id: string;
  /**
   * Where the image lives.
   *
   * Empty means "draw the generated tile instead", which is the same fallback
   * `ProfileImage` uses for a profile with no upload. A real value is a device
   * file URI from the admin importer, or a data URI on web, where blob URLs do
   * not survive a reload.
   */
  imageUri: string;
  /**
   * A grid-sized copy of the same photo.
   *
   * Optional rather than an empty string, because absence is meaningful: a post
   * written before the importer produced two copies simply has one, and it must
   * keep rendering rather than be rejected or rewritten. Consumers fall back to
   * `imageUri` when it is missing.
   *
   * The grid and the full-screen viewer want genuinely different files. A masonry
   * tile is about 160 points wide and the viewer about 330, so one stored image
   * means either the grid decodes full-size bitmaps ten at a time or the viewer
   * upscales a thumbnail. On a phone that is the difference between a soft
   * full-screen photo and a sharp one.
   */
  thumbUri?: string;
  /**
   * Pixel dimensions of `imageUri`, recorded at import.
   *
   * Stored rather than measured with `Image.getSize` for the same reason
   * `tileAspectRatio` avoided measuring: measurement resolves after first paint,
   * so the full-screen card would visibly re-flow as photos loaded. A value read
   * from storage is known on the first frame.
   *
   * Absent on seeded posts and on anything imported before this existed; the
   * viewer falls back to filling its box rather than assuming a ratio.
   */
  width?: number;
  height?: number;
  /**
   * Free text, in the canonical form `normaliseTag` produces. Ordered, and never
   * empty. The first entry is the primary tag: it is the one shown as the caption
   * and the one a co-like is attributed to in the match reason, so it has to be a
   * defined thing rather than "whichever came first when rendering".
   */
  tags: string[];
  createdAt: string;
}

/**
 * One person's answer to one post. At most one row per (userId, postId); a
 * second reaction replaces the first rather than stacking, so a dislike after a
 * like means dislike and never both.
 */
export interface PostReaction {
  id: string;
  userId: string;
  postId: string;
  action: PostReactionAction;
  createdAt: string;
}

/**
 * `like` is evidence and `dislike` is not.
 *
 * A like is a positive statement about what somebody wants, so it counts towards
 * the affinity between two people. A dislike is only a steering signal for the
 * feed itself: it suppresses similar photos from appearing again. Two people
 * disliking the same photo have not agreed on anything, and counting it would
 * pair them for the one thing they demonstrably do not share.
 */
export type PostReactionAction = 'like' | 'dislike';

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
