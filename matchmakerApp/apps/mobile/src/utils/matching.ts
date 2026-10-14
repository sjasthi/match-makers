import type { RelationshipGoal, User } from '@match-makers/shared';

/**
 * Point budget.
 *
 * Shared photo taste owns 80 of the 100. That is a deliberate inversion of FP3,
 * where a stated questionnaire owned 45 and the photo feed was worth 10: the
 * question of what somebody actually wants in a partner is now answered by what
 * they have chosen to spend a tap on, and by the stated answers being treated as
 * a gate rather than a score.
 *
 * Which is why there is no point value for age range or gender preference any
 * more. Both are already hard eligibility rules (`utils/eligibility.ts`) and were
 * being counted twice — filtered out *and* worth 20 points between them.
 *
 * The remaining 20 is deliberately small. Everything in it is a fact about
 * somebody rather than a preference they set, so none of it can be tuned into
 * overriding the taste signal.
 */
export const MATCH_WEIGHTS = {
  sharedTaste: 80,
  relationshipGoal: 10,
  mutualOrientation: 6,
  verified: 4,
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
  score: number;
  sharedGoals: boolean;
  mutualOrientation: boolean;
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

function goalAffinity(mine: RelationshipGoal, theirs: RelationshipGoal): number {
  const rank: Record<RelationshipGoal, number> = {
    long_term: 3,
    short_term: 2,
    casual: 1,
    friendship: 1,
    not_sure: 0,
  };
  const distance = Math.abs(rank[mine] - rank[theirs]);
  return Math.max(0, 1 - distance / 3);
}

/**
 * Scores a candidate out of 100.
 *
 * `taste` is the photo feed's contribution and is optional, so a caller with no
 * reactions table loaded scores exactly as before rather than crashing. Note what
 * a missing signal now means: with taste at 80, a caller that passes nothing gets
 * a deck ordered almost entirely by the 20 points of stated fact, which is why
 * the deck labels the score provisional until enough photos have been answered.
 */
export function scoreCompatibility(
  viewer: User,
  candidate: User,
  taste: TasteSignal = NO_TASTE
): CompatibilityBreakdown {
  const sharedGoals = viewer.relationshipGoal === candidate.relationshipGoal;
  const mutualOrientation = viewer.sexualOrientation === candidate.sexualOrientation;

  const raw =
    taste.affinity * MATCH_WEIGHTS.sharedTaste +
    goalAffinity(viewer.relationshipGoal, candidate.relationshipGoal) *
      MATCH_WEIGHTS.relationshipGoal +
    (mutualOrientation ? 1 : 0) * MATCH_WEIGHTS.mutualOrientation +
    (candidate.isVerified ? 1 : 0) * MATCH_WEIGHTS.verified;

  return {
    score: Math.round(Math.min(100, raw)),
    sharedGoals,
    mutualOrientation,
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

export function compatibilityLabel(score: number): string {
  if (score >= 80) return 'Strong match';
  if (score >= 60) return 'Good match';
  if (score >= 40) return 'Worth a look';
  if (score > 0) return 'Little in common yet';
  return 'Not enough to go on';
}
