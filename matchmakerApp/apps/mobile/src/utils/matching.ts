import type {
  RelationshipGoal,
  User,
  UserQuestionnaire,
  PromptTag,
  PromptAnswer,
  PromptChoice,
  PartnerValue,
} from '@match-makers/shared';
import { emptyLifestyle } from '@match-makers/shared';

import { ageFromDateOfBirth } from '@/utils/mockData';

/**
 * Point budget. Every signal below is worth a fixed number and the total is
 * 100, so a score reads as "how much of this is a match" rather than an
 * accumulation that happens to land near 100.
 */
export const MATCH_WEIGHTS = {
  valueAlignment: 30,
  relationshipGoal: 20,
  mutualOrientation: 10,
  ageFit: 10,
  genderPreference: 10,
  lifestyle: 10,
  promptOverlap: 5,
  verified: 5,
} as const;

/**
 * A deal breaker is a veto, not a deduction. Someone who named something they
 * cannot compromise on, paired with a person who does not have it, is not a
 * slightly worse match, they are not a match. Subtracting points would dress
 * that up as a near miss and quietly put them back in the deck.
 *
 * Direction matters: a deal breaker means "non-negotiable for me", so it is
 * violated by the *absence* of that value in the other person. Rejecting
 * people who share it, which is the naive reading, would penalise the most
 * compatible matches in the deck.
 */
export const DEAL_BREAKER_CEILING = 24;

export interface CompatibilityBreakdown {
  score: number;
  sharedGoals: boolean;
  mutualOrientation: boolean;
  ageOverlap: boolean;
  withinRange: boolean;
  /** True when either side's deal breaker appears in the other's values. */
  dealBreakerClash: boolean;
  /** 0..1 for each questionnaire-driven signal, so the card can explain itself. */
  valueAlignment: number;
  lifestyleCompatibility: number;
  promptOverlap: number;
  /**
   * Prompts both people answered and agreed on, strongest first.
   *
   * Named for agreement rather than co-answering on purpose. This used to be
   * `sharedPromptTags`, which is exactly the claim the old comparison could not
   * support, and it is what the surfaces below were labelling "in common".
   */
  agreements: PromptAgreement[];
  /** Prompts both people answered and contradicted each other on. */
  conflicts: PromptAgreement[];
}

function questionnaireOf(user: User): UserQuestionnaire | null {
  return user.questionnaire ?? null;
}

// These three are exported and take whatever a caller hands them, including a
// record persisted by an older build whose questionnaire predates the current
// shape. `questionnaire.prompts` on such a record is undefined, and `.map` or
// `.length` on it throws rather than scoring as nothing.
function valuesOf(questionnaire: UserQuestionnaire | null): PartnerValue[] {
  return questionnaire?.values ?? [];
}

function promptsOf(questionnaire: UserQuestionnaire | null): PromptAnswer[] {
  return questionnaire?.prompts ?? [];
}

function dealBreakersOf(questionnaire: UserQuestionnaire | null): PartnerValue[] {
  return questionnaire?.dealBreakers ?? [];
}

/**
 * How much of what one person cares about the other covers, weighted by their
 * own priorities, averaged over both directions so neither side can inflate
 * the number by listing a lot.
 *
 * Reads as: "they cover 60% of the things you ranked, weighted by how much
 * each of those things matters to you."
 *
 * The denominator is the sum of that person's own ratings, not a flat maximum
 * per value. Someone who ranks two things 5 and 3 has an achievable ceiling of
 * 8, so two people who want exactly the same things score 1 rather than being
 * held below it by how harshly they rated the softer one.
 */
export function valueAlignment(mine: UserQuestionnaire, theirs: UserQuestionnaire): number {
  const mineValues = valuesOf(mine);
  const theirsValues = valuesOf(theirs);
  if (mineValues.length === 0 || theirsValues.length === 0) return 0;

  const side = (a: UserQuestionnaire, aValues: PartnerValue[], bValues: PartnerValue[]) => {
    const importance = a.importance ?? {};
    const possible = aValues.reduce((sum, value) => sum + (importance[value] ?? 0), 0);
    if (possible === 0) return 0;

    const covered = aValues.reduce(
      (sum, value) => sum + (bValues.includes(value) ? (importance[value] ?? 0) : 0),
      0
    );
    return covered / possible;
  };

  return (side(mine, mineValues, theirsValues) + side(theirs, theirsValues, mineValues)) / 2;
}

/**
 * Lifestyle friction, 0..1. Every field is a mild signal; the average says
 * "you would probably get on fine" without pretending to predict anything.
 */
export function lifestyleCompatibility(mine: UserQuestionnaire, theirs: UserQuestionnaire): number {
  const a = mine?.lifestyle ?? emptyLifestyle();
  const b = theirs?.lifestyle ?? emptyLifestyle();
  const fields: Array<keyof typeof a> = ['schedule', 'exercise', 'smoking', 'drinking', 'pets'];
  const matches = fields.filter((field) => a[field] === b[field]).length;
  return matches / fields.length;
}

/**
 * How much two answers to the same prompt agree, 0..1.
 *
 * A prompt answer is a stance, not a topic. An earlier version compared only
 * which prompts two people had both answered, so a flat "No" scored as full
 * agreement with a flat "Yes" and the profile screen described the result as
 * "prompts in common". Both halves of that were wrong: the score ignored the
 * answer, and the copy then claimed agreement the data did not contain.
 *
 * The four answers are two firm stances (`yes`, `no`) and two hedges
 * (`sometimes`, `depends`). A hedge is partial agreement with the stance it
 * leans towards and weak agreement with the one it leans away from, which is
 * why `depends` sits low against nearly everything: "it depends" is closer to
 * declining to answer than to holding a position.
 *
 * Written out rather than derived from a scale because every cell is a claim
 * about human behaviour that a reader can argue with, and a table can be argued
 * with row by row. It is symmetric because the caller averages both directions.
 */
const CHOICE_AFFINITY: Record<PromptChoice, Record<PromptChoice, number>> = {
  yes: { yes: 1, no: 0, sometimes: 0.5, depends: 0.2 },
  no: { yes: 0, no: 1, sometimes: 0.5, depends: 0.2 },
  sometimes: { yes: 0.5, no: 0.5, sometimes: 1, depends: 0.6 },
  depends: { yes: 0.2, no: 0.2, sometimes: 0.6, depends: 1 },
};

export function choiceAffinity(mine: PromptChoice, theirs: PromptChoice): number {
  return CHOICE_AFFINITY[mine][theirs];
}

/** One prompt both people answered, with the two answers kept side by side. */
export interface PromptAgreement {
  promptId: string;
  tag: PromptTag;
  myChoice: PromptChoice;
  theirChoice: PromptChoice;
  /** `choiceAffinity` of the two answers. Zero means direct contradiction. */
  affinity: number;
}

export interface PromptOverlapResult {
  /** Agreement credit earned over the prompts either side answered, 0..1. */
  ratio: number;
  /** Affinity above zero, strongest agreement first. */
  agreements: PromptAgreement[];
  /** Affinity of zero: they said opposite things. */
  conflicts: PromptAgreement[];
}

/** Shared by reference so a questionnaire-less pair cannot be mutated into agreement. */
const EMPTY_PROMPT_OVERLAP: PromptOverlapResult = {
  ratio: 0,
  agreements: [],
  conflicts: [],
};

/**
 * Agreement on the prompts both people answered, 0..1.
 *
 * This is why prompts replaced free-floating interest tags. Answering the same
 * question is comparable; independently picking from a list of two dozen tags
 * almost never overlapped, so the signal sat at zero.
 *
 * The denominator is still the union of tags either person answered, so
 * answering more prompts still earns coverage. What changed is the numerator:
 * a shared question contributes its agreement rather than a flat point for
 * having both been asked it, so two people with opposite views now score
 * nothing on that prompt instead of full credit for it.
 */
export function promptOverlap(
  mine: UserQuestionnaire,
  theirs: UserQuestionnaire
): PromptOverlapResult {
  const mineByTag = new Map(promptsOf(mine).map((answer) => [answer.tag, answer]));
  const theirsByTag = new Map(promptsOf(theirs).map((answer) => [answer.tag, answer]));

  const union = new Set([...mineByTag.keys(), ...theirsByTag.keys()]);
  if (union.size === 0) return EMPTY_PROMPT_OVERLAP;

  let earned = 0;
  const agreements: PromptAgreement[] = [];
  const conflicts: PromptAgreement[] = [];

  for (const tag of union) {
    const myAnswer = mineByTag.get(tag);
    const theirAnswer = theirsByTag.get(tag);
    // Answered by one side only. Nothing to compare, and the union denominator
    // already charges for the missing answer.
    if (!myAnswer || !theirAnswer) continue;

    const affinity = choiceAffinity(myAnswer.choice, theirAnswer.choice);
    earned += affinity;

    const record: PromptAgreement = {
      promptId: theirAnswer.promptId,
      tag,
      myChoice: myAnswer.choice,
      theirChoice: theirAnswer.choice,
      affinity,
    };
    (affinity > 0 ? agreements : conflicts).push(record);
  }

  return {
    ratio: earned / union.size,
    agreements: agreements.sort((a, b) => b.affinity - a.affinity),
    conflicts,
  };
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
 * Scores a candidate out of 100.
 *
 * The questionnaire signals dominate because they are the only ones that
 * describe what a person actually wants, rather than basic eligibility. The
 * older demographic signals are kept as a floor so that two people who have
 * answered nothing still get an honest, ordered deck instead of all zeroes.
 */
export function scoreCompatibility(viewer: User, candidate: User): CompatibilityBreakdown {
  const sharedGoals = viewer.relationshipGoal === candidate.relationshipGoal;
  const mutualOrientation = viewer.sexualOrientation === candidate.sexualOrientation;
  const theirAge = ageFromDateOfBirth(candidate.dateOfBirth);
  const withinRange =
    theirAge >= viewer.preferences.ageRange.min && theirAge <= viewer.preferences.ageRange.max;
  const ageOverlap = Math.max(viewer.preferences.ageRange.min, 18) <= theirAge;
  const wantsTheirGender = viewer.preferences.genders.includes(candidate.gender);

  const mine = questionnaireOf(viewer);
  const theirs = questionnaireOf(candidate);

  // With no questionnaire on either side there is nothing to compare, so the
  // questionnaire signals contribute nothing rather than being counted as zero
  // agreement.
  const valueFit = mine && theirs ? valueAlignment(mine, theirs) : 0;
  const lifestyleFit = mine && theirs ? lifestyleCompatibility(mine, theirs) : 0;
  const prompts = mine && theirs ? promptOverlap(mine, theirs) : EMPTY_PROMPT_OVERLAP;

  const raw =
    valueFit * MATCH_WEIGHTS.valueAlignment +
    goalAffinity(viewer.relationshipGoal, candidate.relationshipGoal) *
      MATCH_WEIGHTS.relationshipGoal +
    (mutualOrientation ? 1 : 0) * MATCH_WEIGHTS.mutualOrientation +
    (withinRange ? 1 : ageOverlap ? 0.5 : 0) * MATCH_WEIGHTS.ageFit +
    (wantsTheirGender ? 1 : 0) * MATCH_WEIGHTS.genderPreference +
    lifestyleFit * MATCH_WEIGHTS.lifestyle +
    prompts.ratio * MATCH_WEIGHTS.promptOverlap +
    (candidate.isVerified ? 1 : 0) * MATCH_WEIGHTS.verified;

  const dealBreakerClash = Boolean(
    mine &&
    theirs &&
    (dealBreakersOf(mine).some((value) => !valuesOf(theirs).includes(value)) ||
      dealBreakersOf(theirs).some((value) => !valuesOf(mine).includes(value)))
  );

  const score = Math.round(
    Math.min(100, dealBreakerClash ? Math.min(raw, DEAL_BREAKER_CEILING) : raw)
  );

  return {
    score,
    sharedGoals,
    mutualOrientation,
    ageOverlap,
    withinRange,
    dealBreakerClash,
    valueAlignment: round2(valueFit),
    lifestyleCompatibility: round2(lifestyleFit),
    promptOverlap: round2(prompts.ratio),
    agreements: prompts.agreements,
    conflicts: prompts.conflicts,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function compatibilityLabel(score: number): string {
  if (score >= 80) return 'Strong match';
  if (score >= 60) return 'Good match';
  if (score >= 40) return 'Worth a look';
  return 'Outside your range';
}

/** Shown instead of a percentage when a deal breaker rules the pairing out. */
export function dealBreakerLabel(): string {
  return 'Deal breaker mismatch';
}
