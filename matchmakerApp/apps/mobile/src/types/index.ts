import type { AuthMode, SessionState } from '@/services/auth/AuthAdapter';
import type { SwipeAction, User } from '@match-makers/shared';
import type { CompatibilityBreakdown } from '@/utils/matching';

export type { AuthMode, SessionState };

/**
 * One card in the deck: the person, and the score the deck was ordered by.
 *
 * The breakdown travels with the user rather than being recomputed at render
 * time, because two copies of a score is two chances to disagree. `scoreCompatibility`
 * takes a taste signal that only the feed layer can supply, so a card that
 * re-scored itself from two `User`s would quietly show the percentage without
 * the photo-feed bonus — while sitting in a position the feed chose *with* that
 * bonus applied. The card would then disagree with its own ordering.
 */
export interface DeckCandidate {
  user: User;
  compatibility: CompatibilityBreakdown;
}

export interface FeedPage {
  items: DeckCandidate[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  /**
   * Why the deck came back empty, in a sentence, when it did and only then.
   *
   * An empty feed is indistinguishable from an empty match pool unless the app
   * says which of the two it is, and a filter that can empty your deck without
   * explanation is a filter people learn to distrust.
   */
  blockedReason: string | null;
  /**
   * True when the deck is empty because the viewer has not liked any photos.
   *
   * The deck used to open with cards ranked on the twenty points of stated
   * fact — goal, orientation, verified — which handed a brand new account an
   * "11% match, not enough to go on" card that meant nothing. An empty deck
   * that says why is honest; a weak number dressed as a match is not.
   *
   * Separated from `blockedReason` on purpose: that field is about filters the
   * person can widen, and offering "adjust preferences" to somebody whose
   * problem is that they have answered nothing would send them to fix a
   * setting that was never wrong.
   */
  needsTaste: boolean;
}

export type SwipeType = SwipeAction['type'];

export interface SwipeOutcome {
  swipeId: string;
  isMatch: boolean;
  matchId?: string;
  matchedUser?: User;
}

export type LoadState = 'idle' | 'loading' | 'refreshing' | 'error' | 'success';

export interface Loadable<T> {
  state: LoadState;
  data: T | null;
  error: string | null;
}

export const INITIAL_LOADABLE = {
  state: 'idle',
  data: null,
  error: null,
} as const;
