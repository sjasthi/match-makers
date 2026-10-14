import { Gender, type DistanceMode, type Location, type User } from '@match-makers/shared';

import { distanceKm, hasCoordinates } from '@/utils/distance';
import { ageFromDateOfBirth } from '@/utils/mockData';

/**
 * Why a pair failed a requirement, as a code rather than a sentence.
 *
 * Codes so the feed can tally them and name the dominant one in an empty deck,
 * and so the rules themselves stay testable without asserting on English.
 *
 * Two of these are not produced by `checkEligibility`:
 *
 * - `already_swiped` is not a requirement at all, it is a fact about what the
 *   viewer has already done, and it lives in the feed where the swipe record is.
 *   It is still a code because "you have already seen everyone" is the most
 *   common real reason for an empty deck, and folding it into another blocker
 *   would name the wrong setting.
 * - `their_requirements` is the mutual case: you satisfy your own filters and
 *   they still would not see you. Reported separately because telling someone to
 *   widen a setting that is already fine is worse than saying nothing.
 */
export type BlockerCode =
  | 'self'
  | 'already_swiped'
  | 'age'
  | 'gender'
  | 'goal'
  | 'distance'
  | 'missing_location'
  | 'their_requirements';

export interface EligibilityResult {
  eligible: boolean;
  /**
   * Kilometres between the two, or null when either side has no usable
   * coordinates. Reported rather than inferred, because "we could not measure
   * this" and "they are 0 km away" are different answers.
   */
  distanceKm: number | null;
  /** Every requirement that failed, not just the first, so the tally is honest. */
  failures: BlockerCode[];
}

const ELIGIBLE: EligibilityResult = { eligible: true, distanceKm: null, failures: [] };

/**
 * Whether a pair satisfies a distance requirement of `maxDistance` km.
 *
 * Split out because the two missing-data cases are genuinely different decisions
 * and neither is obvious:
 *
 * - The *target* has no coordinates. There is no way to show they are in range,
 *   so we cannot claim the requirement is met. Excluded. This is the direction
 *   that hides a profile, and it is the right direction: the alternative is
 *   quietly widening everyone's nearby radius to accommodate whoever has not
 *   filled in a location.
 * - The *seeker* has no coordinates. Excluding on this would empty their own
 *   deck entirely, and the emptiness would look like "nobody matches you" rather
 *   than "we cannot tell where you are". Treated as global instead, so the deck
 *   still loads while the onboarding step pushes them to fix their location.
 *
 * So the rule fails closed on the other person's data and open on your own.
 */
function distanceSatisfied(
  seeker: Location,
  seekerMode: DistanceMode,
  seekerRadius: number,
  target: Location
): { ok: boolean; distanceKm: number | null; missing: boolean } {
  const seekerKnown = hasCoordinates(seeker);
  const targetKnown = hasCoordinates(target);
  // Measured whenever it can be, including in `global` mode: a card that says
  // "14,000 km away" is more useful than one that goes silent the moment the
  // filter stops caring, and it costs one haversine either way.
  const measured = seekerKnown && targetKnown ? distanceKm(seeker, target) : null;

  if (seekerMode === 'global') return { ok: true, distanceKm: measured, missing: false };
  if (!seekerKnown) return { ok: true, distanceKm: measured, missing: false };
  if (!targetKnown) return { ok: false, distanceKm: null, missing: true };

  return { ok: (measured ?? 0) <= seekerRadius, distanceKm: measured, missing: false };
}

/**
 * Whether `target` satisfies everything `seeker` asked for.
 *
 * One-directional on purpose. `mutualGate` below composes this both ways,
 * because the caller has to know *which* side rejected whom in order to explain
 * an empty deck, and collapsing the two directions throws that away.
 *
 * The gate the feed applies answers one question: could this work at all. Age,
 * gender, distance and relationship goals all fail a pair that a good score does
 * not fix, so none of them is negotiable by how much taste two people happen to
 * share. Sexual orientation stays a scoring signal rather than a gate, because
 * it is not a requirement anybody gets to impose on a stranger.
 */
export function checkEligibility(seeker: User, target: User): EligibilityResult {
  if (seeker.id === target.id) {
    return { eligible: false, distanceKm: null, failures: ['self'] };
  }

  const failures: BlockerCode[] = [];
  const { ageRange, genders, relationshipGoals, distanceMode, maxDistance } = seeker.preferences;

  const targetAge = ageFromDateOfBirth(target.dateOfBirth);
  if (targetAge < ageRange.min || targetAge > ageRange.max) failures.push('age');

  // A target who declined to state their gender is not excluded. "Show me
  // women" is a statement about who you want to see, not a claim that people
  // who withheld an answer are unwanted, and the alternative quietly makes
  // answering honestly a reason to be hidden. This is the opposite of how the
  // distance rule treats a missing location, and deliberately so: the two kinds
  // of absence are not the same. Distance is a hard geographic fact you cannot
  // check at all, whereas an unstated gender is a range of possibilities that
  // very often includes what you asked for.
  if (target.gender !== Gender.PREFER_NOT_TO_SAY && !genders.includes(target.gender)) {
    failures.push('gender');
  }

  // Relationship goal was collected, validated, displayed and stored for three
  // releases without ever being compared to anything. It is a preference now, and
  // preferences are gates: a pair whose stated directions differ is not fixed by
  // liking the same photos, so this refuses rather than scores.
  //
  // An empty list means "no stated preference", not "everyone is acceptable".
  // Treating an unanswered question as a wildcard would let an account that never
  // picked a goal into everybody's deck, which is the opposite of what picking one
  // is for.
  if (relationshipGoals.length > 0 && !relationshipGoals.includes(target.relationshipGoal)) {
    failures.push('goal');
  }

  const distance = distanceSatisfied(seeker.location, distanceMode, maxDistance, target.location);

  if (distance.missing) failures.push('missing_location');
  else if (!distance.ok) failures.push('distance');

  if (failures.length === 0) return { ...ELIGIBLE, distanceKm: distance.distanceKm };
  return { eligible: false, distanceKm: distance.distanceKm, failures };
}

/**
 * Whether the two of them could be shown to each other at all.
 *
 * Both directions, with the reasons kept apart.
 *
 * This exists because the two sides of the product independently reimplemented
 * "who can I see", and they drifted. The deck filtered its candidates and the
 * taste summary did not, so the summary would name as "closest" people the deck
 * would never show — the app promising a consequence it had already ruled out.
 * One definition of the rule, called by both, is what stops that coming back.
 *
 * `blockedByYou` and `blockedByThem` are kept separate rather than merged into
 * one list: they are different problems with different fixes, and the feed's
 * empty state has to name the right one.
 */
export function mutualGate(
  seeker: User,
  target: User
): { eligible: boolean; blockedByYou: BlockerCode[]; blockedByThem: BlockerCode[] } {
  const yours = checkEligibility(seeker, target);
  const theirs = checkEligibility(target, seeker);

  return {
    eligible: yours.eligible && theirs.eligible,
    blockedByYou: yours.failures,
    blockedByThem: theirs.failures,
  };
}

/**
 * Distance between two profiles, or null if either lacks usable coordinates.
 *
 * Exposed because displaying "12 km away" needs the same number the filter used.
 * Reusing `checkEligibility` for it would work but would be a lie about intent,
 * since the caller wants the measurement whether or not it is within range.
 */
export function distanceBetween(a: User, b: User): number | null {
  if (!hasCoordinates(a.location) || !hasCoordinates(b.location)) return null;
  return distanceKm(a.location, b.location);
}

/**
 * The requirement that blocked the most candidates, as a sentence.
 *
 * An empty deck with no explanation is the worst outcome a discovery filter can
 * produce: it is indistinguishable from having no matches. Naming the dominant
 * blocker turns "you saw nobody" into "you saw nobody because of this setting".
 *
 * Dominant by count, because one person failing a requirement says nothing while
 * twenty failing the same one is the reason the deck is empty.
 */
export function summariseBlockers(blockers: readonly BlockerCode[]): string {
  if (blockers.length === 0) return 'There is nobody else here yet.';

  const tally = new Map<BlockerCode, number>();
  for (const blocker of blockers) tally.set(blocker, (tally.get(blocker) ?? 0) + 1);

  const dominant = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!dominant) return 'There is nobody else here yet.';

  const [blocker, count] = dominant;
  const everyone = count === blockers.length;

  const reasons: Record<BlockerCode, string> = {
    self: 'your own profile',
    already_swiped: 'people you have already swiped on',
    age: 'your age range',
    gender: 'who you have chosen to see',
    goal: 'the relationship goals you have chosen',
    distance: 'your distance limit',
    missing_location: 'people who have not set a location',
    their_requirements: 'people who have filtered you out',
  };

  const reason = reasons[blocker];
  return everyone
    ? `Everyone here is blocked by ${reason}.`
    : `Most people here are blocked by ${reason}.`;
}
