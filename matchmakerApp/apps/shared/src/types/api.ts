import type { DistanceMode, Post, PostReactionAction, SwipeAction } from './index';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Field-level messages keyed by form field name. */
  fieldErrors?: Record<string, string>;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface FeedQuery {
  page?: number;
  pageSize?: number;
  /**
   * Documented for completeness. The server reads the caller's own stored
   * preferences to build a deck, so the client does not send any of these --
   * they exist here to pin the shape of the filtering the endpoint applies.
   */
  distanceMode?: DistanceMode;
  maxDistance?: number;
  minAge?: number;
  maxAge?: number;
  excludeIds?: string[];
}

export interface SwipeRequest {
  targetUserId: string;
  action: SwipeAction['type'];
}

export interface SwipeResponse {
  swipeId: string;
  isMatch: boolean;
  match?: MatchPair;
}

export interface MatchPair {
  id: string;
  matchedAt: string;
  user: MatchedUserSummary;
}

export interface MatchedUserSummary {
  id: string;
  name: string;
  primaryPhotoUrl: string | null;
  isVerified: boolean;
}

export interface Conversation {
  matchId: string;
  user: MatchedUserSummary;
  lastMessage: MessageSummary | null;
  unreadCount: number;
  updatedAt: string;
}

export interface MessageSummary {
  id: string;
  senderId: string;
  content: string;
  sentAt: string;
}

export interface VerificationStatus {
  status: 'unverified' | 'pending' | 'verified' | 'rejected';
  method?: 'document' | 'selfie' | 'phone' | 'email';
  submittedAt?: string;
  rejectionReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Photo feed (FP4)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The photo feed: the whole site library, plus what this caller has told the
 * matcher about it.
 *
 * Every photo is returned, answered or not, rather than only the unanswered
 * ones. That is what makes undo possible — a photo you can change your mind
 * about has to still be on screen to change your mind about — and it means the
 * grid's "N of M answered" count is the only work-queue signal it needs.
 */
export interface PhotoFeedPage {
  posts: Post[];
  /**
   * This caller's own answer per post id. A missing key means unanswered.
   *
   * A map rather than a count because a tile has to render *which* way it was
   * answered, and N+1 lookups to find that out would be absurd for a grid.
   */
  reactions: Record<string, PostReactionAction>;
  /**
   * Size of the whole site library, so the screen can tell "every photo answered"
   * apart from "nobody has imported any photos". Both look identical from the
   * posts array alone, and they are opposite problems with opposite fixes.
   */
  total: number;
  /** Like/dislike totals plus the per-tag breakdown, for the summary strip. */
  summary: TasteSummary;
}

export interface PostReactionRequest {
  postId: string;
  action: PostReactionAction;
}

export interface TasteSummary {
  likes: number;
  dislikes: number;
  /** How strongly the caller leans towards each tag they have an opinion on. */
  tags: Array<{ tag: string; score: number; likes: number; dislikes: number }>;
  /**
   * People the caller's reactions have pulled them towards.
   *
   * This is the whole point of the feed, so it is returned rather than left for
   * the caller to derive from the deck it is about to be shown.
   *
   * Everyone listed here has passed the same eligibility gate the deck applies,
   * in both directions. It used to be every other account in the database, which
   * let the summary name as "closest" people the deck would never show — the app
   * promising a consequence it had already ruled out. Anything the summary names
   * is now something the caller can actually be shown.
   *
   * Ordered by `affinity`, strongest first, because the compact feed strip reads
   * as a list. The full profile screen presents these as a grid, where a grid has
   * no first and so makes no claim the deck's own ordering can contradict.
   */
  closest: Array<{
    userId: string;
    name: string;
    /**
     * The deck's own number: taste plus the stated facts, out of 100.
     *
     * Carried so the profile grid can show the same percentage the deck card
     * shows. Showing `affinity` there instead meant two different percentages for
     * the same word "match", on two screens a swipe apart.
     */
    score: number;
    /** How much of the pair's evidence is shared photo taste, 0..1. */
    affinity: number;
    /** Photos both people liked. Lets the detail screen rebuild the breakdown. */
    coLikedPosts: number;
    sharedTags: string[];
    reason: string;
  }>;
  /**
   * True when nobody eligible overlaps, but somebody ineligible did.
   *
   * Without it the profile screen cannot tell "you have not answered enough
   * photos" apart from "everyone you share photos with is outside your filters",
   * and it would blame the person for a setting they can change.
   */
  closestBlockedByFilters?: boolean;
}
