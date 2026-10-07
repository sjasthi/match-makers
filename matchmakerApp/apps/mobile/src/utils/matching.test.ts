import {
  scoreCompatibility,
  compatibilityLabel,
  valueAlignment,
  lifestyleCompatibility,
  promptOverlap,
  choiceAffinity,
  MATCH_WEIGHTS,
  DEAL_BREAKER_CEILING,
  dealBreakerLabel,
} from './matching';
import {
  generateDemoUser,
  generateMockUser,
  generateMockUsers,
  ageFromDateOfBirth,
} from './mockData';
import {
  Gender,
  RelationshipGoal,
  SexualOrientation,
  PartnerValue,
  PromptTag,
  PromptChoice,
  ScheduleType,
  ExerciseLevel,
  SmokingStatus,
  DrinkingStatus,
  PetsPreference,
  ImportanceScale,
  type User,
  type UserQuestionnaire,
} from '@match-makers/shared';

function questionnaire(overrides: Partial<UserQuestionnaire> = {}): UserQuestionnaire {
  return {
    values: [PartnerValue.KINDNESS, PartnerValue.SENSE_OF_HUMOUR],
    importance: {
      [PartnerValue.KINDNESS]: ImportanceScale.NON_NEGOTIABLE,
      [PartnerValue.SENSE_OF_HUMOUR]: ImportanceScale.IMPORTANT,
    },
    dealBreakers: [],
    prompts: [
      { promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.YES },
      { promptId: 'kitchen', tag: PromptTag.FOOD, choice: PromptChoice.YES },
    ],
    lifestyle: {
      schedule: ScheduleType.EARLY_BIRD,
      exercise: ExerciseLevel.MODERATE,
      smoking: SmokingStatus.NEVER,
      drinking: DrinkingStatus.SOCIALLY,
      pets: PetsPreference.LOVE_PETS,
    },
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return { ...generateDemoUser(), ...overrides } as User;
}

/** A viewer that always shares demographics with the candidate, so a test can isolate one signal. */
const VIEWER = makeUser({
  dateOfBirth: '1995-05-20',
  gender: Gender.FEMALE,
  sexualOrientation: SexualOrientation.STRAIGHT,
  relationshipGoal: RelationshipGoal.LONG_TERM,
  isVerified: true,
  preferences: {
    ageRange: { min: 24, max: 40 },
    distanceMode: 'nearby',
    maxDistance: 50,
    genders: [Gender.FEMALE],
    relationshipGoals: [RelationshipGoal.LONG_TERM],
  },
  questionnaire: questionnaire(),
});

function candidate(overrides: Partial<User> = {}): User {
  return {
    ...makeUser({
      dateOfBirth: '1995-05-20',
      gender: Gender.FEMALE,
      sexualOrientation: SexualOrientation.STRAIGHT,
      relationshipGoal: RelationshipGoal.LONG_TERM,
      isVerified: true,
      preferences: {
        ageRange: { min: 24, max: 40 },
        distanceMode: 'nearby',
        maxDistance: 50,
        genders: [Gender.FEMALE],
        relationshipGoals: [RelationshipGoal.LONG_TERM],
      },
      questionnaire: questionnaire(),
    }),
    ...overrides,
  };
}

describe('ageFromDateOfBirth', () => {
  it('returns a sensible age for a birthday earlier this year', () => {
    const thisYear = new Date().getFullYear();
    expect(ageFromDateOfBirth(`${thisYear - 30}-01-01`)).toBeGreaterThanOrEqual(29);
    expect(ageFromDateOfBirth(`${thisYear - 30}-01-01`)).toBeLessThanOrEqual(30);
  });
});

describe('valueAlignment', () => {
  it('is 1 when two people want exactly the same things', () => {
    expect(valueAlignment(questionnaire(), questionnaire())).toBe(1);
  });

  it('is 0 when nothing overlaps', () => {
    const mine = questionnaire({
      values: [PartnerValue.KINDNESS],
      importance: { [PartnerValue.KINDNESS]: ImportanceScale.NON_NEGOTIABLE },
    });
    const theirs = questionnaire({
      values: [PartnerValue.AMBITION],
      importance: { [PartnerValue.AMBITION]: ImportanceScale.NON_NEGOTIABLE },
    });
    expect(valueAlignment(mine, theirs)).toBe(0);
  });

  it('weights partial coverage by how much the shared value matters to me', () => {
    // Both of us want kindness and one other thing; you only share kindness.
    // How much that single overlap counts should depend on where kindness sits
    // in my own ranking, which is the whole point of storing an importance.
    const sharedIsTop = questionnaire({
      values: [PartnerValue.KINDNESS, PartnerValue.AMBITION],
      importance: {
        [PartnerValue.KINDNESS]: ImportanceScale.NON_NEGOTIABLE,
        [PartnerValue.AMBITION]: ImportanceScale.NICE_TO_HAVE,
      },
    });
    const sharedIsBottom = questionnaire({
      values: [PartnerValue.KINDNESS, PartnerValue.AMBITION],
      importance: {
        [PartnerValue.KINDNESS]: ImportanceScale.NICE_TO_HAVE,
        [PartnerValue.AMBITION]: ImportanceScale.NON_NEGOTIABLE,
      },
    });
    const onlySharesKindness = questionnaire({
      values: [PartnerValue.KINDNESS],
      importance: { [PartnerValue.KINDNESS]: ImportanceScale.NON_NEGOTIABLE },
    });

    expect(valueAlignment(sharedIsTop, onlySharesKindness)).toBeGreaterThan(
      valueAlignment(sharedIsBottom, onlySharesKindness)
    );
  });

  it('scores 1 for identical answers regardless of how harshly they were graded', () => {
    // The denominator is each person's own ratings, so downgrading a softer
    // value must not cost you a match you would otherwise score full marks on.
    const graded = questionnaire({
      values: [PartnerValue.KINDNESS, PartnerValue.AMBITION],
      importance: {
        [PartnerValue.KINDNESS]: ImportanceScale.NON_NEGOTIABLE,
        [PartnerValue.AMBITION]: ImportanceScale.NICE_TO_HAVE,
      },
    });
    expect(valueAlignment(graded, graded)).toBe(1);
  });

  it('averages both directions so a long list cannot inflate the number', () => {
    const narrow = questionnaire({
      values: [PartnerValue.KINDNESS],
      importance: { [PartnerValue.KINDNESS]: ImportanceScale.NON_NEGOTIABLE },
    });
    const wide = questionnaire({
      values: [
        PartnerValue.KINDNESS,
        PartnerValue.AMBITION,
        PartnerValue.FAMILY,
        PartnerValue.INDEPENDENCE,
        PartnerValue.EMOTIONAL_OPENNESS,
      ],
      importance: {
        [PartnerValue.KINDNESS]: ImportanceScale.NON_NEGOTIABLE,
        [PartnerValue.AMBITION]: ImportanceScale.NON_NEGOTIABLE,
        [PartnerValue.FAMILY]: ImportanceScale.NON_NEGOTIABLE,
        [PartnerValue.INDEPENDENCE]: ImportanceScale.NON_NEGOTIABLE,
        [PartnerValue.EMOTIONAL_OPENNESS]: ImportanceScale.NON_NEGOTIABLE,
      },
    });

    // The narrow person is fully covered by the wide one (5/5); the wide
    // person is only covered on one of five (5/25). Averaging gives 0.6 for
    // both orderings, so listing more cannot buy a higher number.
    expect(valueAlignment(narrow, wide)).toBeCloseTo((1 + 0.2) / 2, 5);
    expect(valueAlignment(wide, narrow)).toBeCloseTo((0.2 + 1) / 2, 5);
    expect(valueAlignment(narrow, wide)).toBe(valueAlignment(wide, narrow));
  });

  it('is 0 when either side answered no values', () => {
    expect(valueAlignment(questionnaire({ values: [], importance: {} }), questionnaire())).toBe(0);
  });
});

describe('lifestyleCompatibility', () => {
  it('is 1 when every answer matches', () => {
    expect(lifestyleCompatibility(questionnaire(), questionnaire())).toBe(1);
  });

  it('drops when nothing matches', () => {
    const other = questionnaire({
      lifestyle: {
        schedule: ScheduleType.NIGHT_OWL,
        exercise: ExerciseLevel.NONE,
        smoking: SmokingStatus.DAILY,
        drinking: DrinkingStatus.NEVER,
        pets: PetsPreference.ALLERGIC,
      },
    });
    expect(lifestyleCompatibility(questionnaire(), other)).toBe(0);
  });
});

describe('choiceAffinity', () => {
  it('gives identical answers full credit', () => {
    for (const choice of [
      PromptChoice.YES,
      PromptChoice.NO,
      PromptChoice.SOMETIMES,
      PromptChoice.DEPENDS,
    ]) {
      expect(choiceAffinity(choice, choice)).toBe(1);
    }
  });

  it('scores a direct contradiction as nothing at all', () => {
    // The single cell that made this whole function necessary: before the fix,
    // answering "No" here scored the same as answering "Yes", because the
    // comparison threw the answer away and looked only at which questions both
    // people had answered.
    expect(choiceAffinity(PromptChoice.YES, PromptChoice.NO)).toBe(0);
    expect(choiceAffinity(PromptChoice.NO, PromptChoice.YES)).toBe(0);
  });

  it('is symmetric, because the caller averages both directions', () => {
    const all = [PromptChoice.YES, PromptChoice.NO, PromptChoice.SOMETIMES, PromptChoice.DEPENDS];
    for (const a of all) {
      for (const b of all) {
        expect(choiceAffinity(a, b)).toBe(choiceAffinity(b, a));
      }
    }
  });

  it('rates a hedge as partial agreement, strongest with the other hedge', () => {
    // "It depends" is closer to declining to answer than to a position, so it
    // sits low against a firm stance but well above it against another hedge.
    expect(choiceAffinity(PromptChoice.SOMETIMES, PromptChoice.YES)).toBe(0.5);
    expect(choiceAffinity(PromptChoice.DEPENDS, PromptChoice.YES)).toBeLessThan(0.5);
    expect(choiceAffinity(PromptChoice.SOMETIMES, PromptChoice.DEPENDS)).toBeGreaterThan(
      choiceAffinity(PromptChoice.DEPENDS, PromptChoice.YES)
    );
  });
});

describe('promptOverlap', () => {
  it('scores agreement, not co-answering', () => {
    // The base fixture answers family and kitchen, both "Yes". The counterpart
    // agrees on one, contradicts the other, and adds a question only they
    // answered, which covers all three branches in one case.
    const theirs = questionnaire({
      prompts: [
        { promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.YES },
        { promptId: 'kitchen', tag: PromptTag.FOOD, choice: PromptChoice.NO },
        { promptId: 'playlist', tag: PromptTag.MUSIC, choice: PromptChoice.YES },
      ],
    });

    const result = promptOverlap(questionnaire(), theirs);

    expect(result.agreements.map((agreement) => agreement.tag)).toEqual([PromptTag.FAMILY]);
    expect(result.conflicts.map((conflict) => conflict.tag)).toEqual([PromptTag.FOOD]);
    // One full agreement out of three distinct tags across both of them.
    // Answering `playlist` earns nothing either way: there is nothing to compare.
    expect(result.ratio).toBeCloseTo(1 / 3, 2);
  });

  it('reports the two answers on a contradiction rather than hiding them', () => {
    const theirs = questionnaire({
      prompts: [{ promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.NO }],
    });

    const conflict = promptOverlap(questionnaire(), theirs).conflicts[0];

    expect(conflict?.tag).toBe(PromptTag.FAMILY);
    expect(conflict?.myChoice).toBe(PromptChoice.YES);
    expect(conflict?.theirChoice).toBe(PromptChoice.NO);
    expect(conflict?.affinity).toBe(0);
  });

  it('gives partial credit for a hedge rather than calling it a conflict', () => {
    const theirs = questionnaire({
      prompts: [{ promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.SOMETIMES }],
    });

    const result = promptOverlap(questionnaire(), theirs);

    expect(result.conflicts).toEqual([]);
    expect(result.agreements).toHaveLength(1);
    // Two distinct tags; `kitchen` was answered by one side only, so it earns
    // nothing and the hedge carries half a point of the one available.
    expect(result.ratio).toBeCloseTo(0.5 / 2, 2);
  });

  it('orders agreements strongest first, so the card leads with the best one', () => {
    const theirs = questionnaire({
      prompts: [
        { promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.DEPENDS },
        { promptId: 'kitchen', tag: PromptTag.FOOD, choice: PromptChoice.YES },
      ],
    });

    const result = promptOverlap(questionnaire(), theirs);

    expect(result.agreements.map((agreement) => agreement.tag)).toEqual([
      PromptTag.FOOD,
      PromptTag.FAMILY,
    ]);
  });

  it('earns full credit only when the answers match', () => {
    const result = promptOverlap(questionnaire(), questionnaire());

    expect(result.ratio).toBe(1);
    expect(result.agreements).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });

  it('is 0 when no prompt is answered twice', () => {
    const theirs = questionnaire({
      prompts: [{ promptId: 'playlist', tag: PromptTag.MUSIC, choice: PromptChoice.YES }],
    });
    expect(promptOverlap(questionnaire(), theirs).ratio).toBe(0);
  });

  it('is 0 rather than a division error when someone answered nothing', () => {
    expect(promptOverlap(questionnaire(), questionnaire({ prompts: [] })).ratio).toBe(0);
  });
});

describe('scoreCompatibility', () => {
  it('scores an ideal candidate at the maximum', () => {
    const result = scoreCompatibility(VIEWER, candidate());
    expect(result.withinRange).toBe(true);
    expect(result.sharedGoals).toBe(true);
    expect(result.mutualOrientation).toBe(true);
    expect(result.dealBreakerClash).toBe(false);
    expect(result.score).toBe(100);
  });

  it('penalises a candidate outside the age range', () => {
    const aged = candidate({ dateOfBirth: '1965-01-01' });

    const inRange = scoreCompatibility(VIEWER, candidate({ dateOfBirth: '1995-01-01' }));
    const outOfRange = scoreCompatibility(VIEWER, aged);

    expect(outOfRange.withinRange).toBe(false);
    expect(outOfRange.score).toBeLessThan(inRange.score);
  });

  it('ignores genders the viewer did not select', () => {
    const unwanted = scoreCompatibility(VIEWER, candidate({ gender: Gender.MALE }));
    expect(unwanted.score).toBeLessThan(scoreCompatibility(VIEWER, candidate()).score);
  });

  it('never exceeds 100 even when every signal maxes out', () => {
    const result = scoreCompatibility(VIEWER, candidate());
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('has weights that add up to a full 100 points', () => {
    const total = Object.values(MATCH_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
  });

  describe('deal breakers', () => {
    // The viewer needs kindness and will not compromise on it. The candidate
    // either shares it or does not, and that is the whole question here.
    const strictViewer = {
      ...VIEWER,
      questionnaire: questionnaire({ dealBreakers: [PartnerValue.KINDNESS] }),
    };
    const withoutKindness = questionnaire({
      values: [PartnerValue.SENSE_OF_HUMOUR],
      importance: { [PartnerValue.SENSE_OF_HUMOUR]: ImportanceScale.IMPORTANT },
      prompts: [],
    });

    it('caps the score when the candidate is missing a non-negotiable value', () => {
      const result = scoreCompatibility(
        strictViewer,
        candidate({ questionnaire: withoutKindness })
      );

      expect(result.dealBreakerClash).toBe(true);
      expect(result.score).toBeLessThanOrEqual(DEAL_BREAKER_CEILING);
    });

    it('catches a gap declared by the candidate, not just the viewer', () => {
      const result = scoreCompatibility(
        VIEWER,
        candidate({
          questionnaire: questionnaire({ dealBreakers: [PartnerValue.FAMILY] }),
        })
      );

      expect(result.dealBreakerClash).toBe(true);
    });

    it('does not fire when the non-negotiable is present on both sides', () => {
      const result = scoreCompatibility(strictViewer, candidate());
      expect(result.dealBreakerClash).toBe(false);
    });

    it('does not penalise the most compatible matches for sharing a value', () => {
      // The naive reading was "reject if they also have it", which caps the
      // highest-scoring people in the deck instead of the lowest.
      expect(scoreCompatibility(strictViewer, candidate()).score).toBeGreaterThan(
        DEAL_BREAKER_CEILING
      );
    });

    it('caps rather than subtracts, so a clash never reads as a near miss', () => {
      const perfect = candidate();
      const unclashed = scoreCompatibility(strictViewer, perfect);

      const clashed = scoreCompatibility(
        strictViewer,
        candidate({
          questionnaire: { ...withoutKindness, lifestyle: perfect.questionnaire!.lifestyle },
        })
      );

      // Raw score is nearly identical; only the veto separates them, and it
      // pins the lower one to a fixed ceiling rather than a small deduction.
      expect(clashed.score).toBe(DEAL_BREAKER_CEILING);
      expect(unclashed.score).toBeGreaterThan(DEAL_BREAKER_CEILING + 40);
    });
  });

  describe('when the questionnaire is missing', () => {
    it('contributes nothing rather than counting as zero agreement', () => {
      const bareViewer = { ...VIEWER, questionnaire: undefined };
      const bareCandidate = { ...candidate(), questionnaire: undefined };

      const result = scoreCompatibility(bareViewer, bareCandidate);

      expect(result.valueAlignment).toBe(0);
      expect(result.lifestyleCompatibility).toBe(0);
      expect(result.promptOverlap).toBe(0);
      // Demographics still carry a score, so the deck stays ordered.
      expect(result.score).toBeGreaterThan(0);
      // goal 20 + orientation 10 + age 10 + gender 10 + verified 5
      expect(result.score).toBe(55);
    });

    it('scores a viewer with answers against a candidate with none', () => {
      const result = scoreCompatibility(VIEWER, { ...candidate(), questionnaire: undefined });
      expect(result.valueAlignment).toBe(0);
      expect(result.score).toBe(55);
    });
  });

  describe('against real seeded data', () => {
    it('produces a spread of scores rather than clustering on one number', () => {
      const viewer = { ...VIEWER, questionnaire: undefined } as User;
      const scores = Array.from(
        { length: 20 },
        (_, index) => scoreCompatibility(viewer, generateMockUser(index + 1) as User).score
      );

      const unique = new Set(scores);
      expect(unique.size).toBeGreaterThan(3);
      expect(Math.min(...scores)).toBeLessThan(Math.max(...scores));
      scores.forEach((score) => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
    });

    it('gives the demo account a deck with a real spread and no veto wall', () => {
      // The demo account is the first thing anyone sees. A flat deck, or one
      // where a deal-breaker veto pins most cards to the ceiling, looks broken
      // even when every calculation is correct.
      const demo = generateDemoUser() as User;
      const scores = generateMockUsers(20).map(
        (candidate) => scoreCompatibility(demo, candidate as User).score
      );

      expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThanOrEqual(20);
      expect(new Set(scores).size).toBeGreaterThanOrEqual(8);
      expect(scores.filter((score) => score === DEAL_BREAKER_CEILING)).toHaveLength(0);
    });

    it('never reports a questionnaire signal for a user that has none', () => {
      const viewer = { ...VIEWER, questionnaire: undefined } as User;
      const result = scoreCompatibility(viewer, generateMockUser(3) as User);
      expect(result.agreements).toEqual([]);
      expect(result.conflicts).toEqual([]);
    });
  });
});

describe('labels', () => {
  it.each([
    [95, 'Strong match'],
    [80, 'Strong match'],
    [70, 'Good match'],
    [60, 'Good match'],
    [50, 'Worth a look'],
    [40, 'Worth a look'],
    [10, 'Outside your range'],
  ])('maps %s to %s', (score, expected) => {
    expect(compatibilityLabel(score)).toBe(expected);
  });

  it('has a label for a deal breaker clash that replaces the percentage', () => {
    expect(dealBreakerLabel()).toBe('Deal breaker mismatch');
  });
});
