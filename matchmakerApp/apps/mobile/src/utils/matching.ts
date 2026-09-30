import type { RelationshipGoal, User } from '@match-makers/shared';
import { ageFromDateOfBirth } from '@/utils/mockData';

export interface CompatibilityBreakdown {
  score: number;
  sharedGoals: boolean;
  mutualOrientation: boolean;
  ageOverlap: boolean;
  withinRange: boolean;
}

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
 * Stand-in for the matching engine described in FP2.
 *
 * Real scoring belongs on the backend, where it can be tuned without shipping
 * an app update. This exists so the feed can surface a meaningful number in the
 * prototype and so the weighting is documented in one place.
 */
export function scoreCompatibility(viewer: User, candidate: User): CompatibilityBreakdown {
  const sharedGoals = viewer.relationshipGoal === candidate.relationshipGoal;
  const mutualOrientation = viewer.sexualOrientation === candidate.sexualOrientation;
  const theirAge = ageFromDateOfBirth(candidate.dateOfBirth);
  const withinRange =
    theirAge >= viewer.preferences.ageRange.min && theirAge <= viewer.preferences.ageRange.max;
  const ageOverlap = Math.max(viewer.preferences.ageRange.min, 18) <= theirAge;
  const wantsTheirGender = viewer.preferences.genders.includes(candidate.gender);

  const score =
    goalAffinity(viewer.relationshipGoal, candidate.relationshipGoal) * 35 +
    (mutualOrientation ? 20 : 0) +
    (withinRange ? 20 : ageOverlap ? 10 : 0) +
    (wantsTheirGender ? 15 : 0) +
    (candidate.isVerified ? 10 : 0);

  return {
    score: Math.round(Math.min(100, score)),
    sharedGoals,
    mutualOrientation,
    ageOverlap,
    withinRange,
  };
}

export function compatibilityLabel(score: number): string {
  if (score >= 80) return 'Strong match';
  if (score >= 60) return 'Good match';
  if (score >= 40) return 'Worth a look';
  return 'Outside your range';
}
