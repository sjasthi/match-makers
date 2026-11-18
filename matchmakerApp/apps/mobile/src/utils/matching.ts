import type { User } from '@match-makers/shared';

/**
 * Point budget.
 *
 * Score is now 100% photo taste affinity. All stated-fact signals (goal,
 * orientation, verified) are visibility gates or badges only, not scoring components.
 */
export const MATCH_WEIGHTS = {
  sharedTaste: 100,
} as const;

export interface TasteSignal {
  /** 0..1 from `tasteBetween`. Zero when there is no shared evidence. */
  affinity: number;
  coLikedPosts: number;
  sharedTags: string[];
  /** The sentence shown under the percentage, or null when there is nothing to say. */
  reason: string | null;
}

export interface CompatibilityBreakdown {
  /** Photo taste affinity × 100. Null when there is no photo evidence yet. */
  score: number | null;
  sharedGoals: boolean;
  /** How much of the pair's shared photo taste earned its points. 0..1. */
  tasteAffinity: number;
  /** Photos both people liked, for the card chip and the breakdown row. */
  coLikedPosts: number;
  sharedTags: string[];
  /**
   * Why the score moved, in words: "you both liked 3 of the same photos, tagged
   * pets and animals". Null when there is nothing to say, which is the common
   * case early on and should not be dressed up as one.
   */
  reason: string | null;
}

/** No evidence: the default for every call that does not concern itself with the feed. */
const NO_TASTE: TasteSignal = { affinity: 0, coLikedPosts: 0, sharedTags: [], reason: null };

/**
 * Scores a candidate out of 100 based purely on photo taste affinity.
 *
 * Returns null when there is no taste signal (affinity = 0), so the UI can show
 * "No score yet" instead of a misleading 0%.
 */
export function scoreCompatibility(
  viewer: User,
  candidate: User,
  taste: TasteSignal = NO_TASTE
): CompatibilityBreakdown {
  const sharedGoals = viewer.relationshipGoal === candidate.relationshipGoal;

  // No photo evidence = no score yet
  if (taste.affinity <= 0) {
    return {
      score: null,
      sharedGoals,
      tasteAffinity: 0,
      coLikedPosts: 0,
      sharedTags: [],
      reason: null,
    };
  }

  return {
    score: Math.round(Math.min(100, taste.affinity * MATCH_WEIGHTS.sharedTaste)),
    sharedGoals,
    tasteAffinity: round2(taste.affinity),
    coLikedPosts: taste.coLikedPosts,
    sharedTags: taste.sharedTags,
    reason: taste.reason,
  };
}

/**
 * Pulls the photo feed's half back out of a breakdown, so a score that has
 * already been computed can be carried somewhere and used again.
 *
 * Written as a function rather than relying on the breakdown happening to be
 * assignable to `TasteSignal`: it is not, because the breakdown names the field
 * `tasteAffinity` while the signal names it `affinity`. Without this, passing a
 * breakdown around as a signal would compile in the places where the shapes
 * happened to line up and silently score zero in the rest.
 */
export function tasteSignalFrom(breakdown: CompatibilityBreakdown): TasteSignal | undefined {
  if (breakdown.tasteAffinity <= 0) return undefined;
  return {
    affinity: breakdown.tasteAffinity,
    coLikedPosts: breakdown.coLikedPosts,
    sharedTags: breakdown.sharedTags,
    reason: breakdown.reason,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function compatibilityLabel(score: number | null): string {
  if (score === null) return 'No score yet';
  if (score >= 80) return 'Strong match';
  if (score >= 60) return 'Good match';
  if (score >= 40) return 'Worth a look';
  if (score > 0) return 'Little in common yet';
  return 'Not enough to go on';
}
