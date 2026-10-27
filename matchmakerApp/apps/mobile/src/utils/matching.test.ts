import {
  scoreCompatibility,
  compatibilityLabel,
  tasteSignalFrom,
  MATCH_WEIGHTS,
  type TasteSignal,
} from './matching';
import {
  generateDemoUser,
  generateMockUser,
  generateMockUsers,
  generateSeedPosts,
  seedReactionsFor,
  ageFromDateOfBirth,
} from './mockData';
import { buildTasteIndex, tasteBetween } from './taste';
import {
  Gender,
  RelationshipGoal,
  SexualOrientation,
  type User,
} from '@match-makers/shared';

function makeUser(overrides: Partial<User> = {}): User {
  return { ...generateDemoUser(), ...overrides } as User;
}

const VIEWER = makeUser({
  dateOfBirth: '1995-05-20',
  gender: Gender.FEMALE,
  sexualOrientation: SexualOrientation.STRAIGHT,
  relationshipGoal: RelationshipGoal.LONG_TERM,
  isVerified: true,
});

function candidate(overrides: Partial<User> = {}): User {
  return makeUser({
    dateOfBirth: '1995-05-20',
    gender: Gender.FEMALE,
    sexualOrientation: SexualOrientation.STRAIGHT,
    relationshipGoal: RelationshipGoal.LONG_TERM,
    isVerified: true,
    ...overrides,
  });
}

/** A taste signal with an explicit affinity, so one test can isolate one signal. */
function taste(affinity: number): TasteSignal {
  return {
    affinity,
    coLikedPosts: Math.round(affinity * 6),
    sharedTags: [],
    reason: 'You both liked the same photos',
  };
}

describe('ageFromDateOfBirth', () => {
  it('is still the age helper eligibility depends on', () => {
    // Removed from `matching.ts` when the score stopped using it, but eligibility
    // and the admin inspector both still age a profile by birth date.
    expect(ageFromDateOfBirth('1995-05-20')).toBeGreaterThanOrEqual(29);
  });
});

describe('scoreCompatibility', () => {
  it('is dominated by shared taste (now 100% of score)', () => {
    const base = scoreCompatibility(VIEWER, candidate());
    const boosted = scoreCompatibility(VIEWER, candidate(), taste(1));

    // Taste now owns 100 of 100. Stated facts (goal, orientation, verified) are gates/badges only.
    expect(MATCH_WEIGHTS.sharedTaste).toBe(100);
    // With no taste, score is null; with full taste, score is 100
    expect(base.score).toBeNull();
    expect(boosted.score).toBe(100);
  });

  it('returns null score when there is no taste signal', () => {
    const result = scoreCompatibility(VIEWER, candidate());
    expect(result.score).toBeNull();
    expect(result.tasteAffinity).toBe(0);
    expect(result.reason).toBeNull();
  });

  it('returns score = affinity * 100 when taste is provided', () => {
    const half = scoreCompatibility(VIEWER, candidate(), taste(0.5));
    expect(half.score).toBe(50);
    expect(half.tasteAffinity).toBe(0.5);

    const full = scoreCompatibility(VIEWER, candidate(), taste(1));
    expect(full.score).toBe(100);
  });

  it('never passes 100', () => {
    const perfect = scoreCompatibility(VIEWER, candidate(), taste(1));
    expect(perfect.score).toBeLessThanOrEqual(100);
  });

  it('reports sharedGoals as informational only (not scored)', () => {
    const same = scoreCompatibility(
      VIEWER,
      candidate({ relationshipGoal: RelationshipGoal.LONG_TERM }),
      taste(0.5)
    );
    const opposite = scoreCompatibility(
      VIEWER,
      candidate({ relationshipGoal: RelationshipGoal.NOT_SURE }),
      taste(0.5)
    );

    expect(same.sharedGoals).toBe(true);
    expect(opposite.sharedGoals).toBe(false);
    // Score is identical because goal is not a scoring signal
    expect(same.score).toBe(opposite.score);
  });

  it('does not include mutualOrientation in breakdown (now a gate)', () => {
    const result = scoreCompatibility(VIEWER, candidate(), taste(0.5));
    expect('mutualOrientation' in result).toBe(false);
  });

  it('does not include verified in score (badge only)', () => {
    const verified = scoreCompatibility(VIEWER, candidate({ isVerified: true }), taste(0.5));
    const not = scoreCompatibility(VIEWER, candidate({ isVerified: false }), taste(0.5));

    expect(verified.score).toBe(not.score);
  });

  it('reports the taste evidence it was given', () => {
    const signal = taste(0.5);
    const result = scoreCompatibility(VIEWER, candidate(), signal);

    expect(result.tasteAffinity).toBe(0.5);
    expect(result.coLikedPosts).toBe(signal.coLikedPosts);
    expect(result.reason).toBe(signal.reason);
  });

  it('says nothing about taste when there is none', () => {
    const result = scoreCompatibility(VIEWER, candidate());

    expect(result.tasteAffinity).toBe(0);
    expect(result.reason).toBeNull();
  });

  it('scores two strangers identically when neither has answered anything', () => {
    const first = scoreCompatibility(VIEWER, candidate({ id: 'a' }));
    const second = scoreCompatibility(
      VIEWER,
      candidate({ id: 'b', relationshipGoal: RelationshipGoal.LONG_TERM })
    );

    expect(first.score).toBe(second.score);
    expect(first.score).toBeNull();
  });

  it('does not penalise or reward age, gender or distance any more', () => {
    const inRange = scoreCompatibility(VIEWER, candidate({ dateOfBirth: '1995-05-20' }), taste(0.5));
    const outOfRange = scoreCompatibility(VIEWER, candidate({ dateOfBirth: '1970-01-01' }), taste(0.5));

    expect(inRange.score).toBe(outOfRange.score);
  });

  it('has no deal-breaker veto left', () => {
    expect('dealBreakerClash' in scoreCompatibility(VIEWER, candidate())).toBe(false);
  });
});

describe('against real seeded data', () => {
  it('orders a deck by taste when taste exists', () => {
    const viewer = VIEWER;
    const others = generateMockUsers(8) as User[];
    const posts = generateSeedPosts(24);
    const reactions = seedReactionsFor([viewer, ...others], posts);
    const index = buildTasteIndex(reactions, posts);

    const scored = others.map((user) =>
      scoreCompatibility(viewer, user, tasteBetween(index, viewer.id, user.id))
    );

    expect(scored.some((result) => result.tasteAffinity > 0)).toBe(true);
    for (const result of scored) {
      if (result.score !== null) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('keeps a liked pair above an unliked one holding everything else equal', () => {
    const other = generateMockUser(3) as User;
    const withoutTaste = scoreCompatibility(VIEWER, other);
    const withTaste = scoreCompatibility(VIEWER, other, taste(0.6));

    expect(withTaste.score).not.toBeNull();
    expect(withoutTaste.score).toBeNull();
    expect(withTaste.score).toBeGreaterThan(0);
  });
});

describe('compatibilityLabel', () => {
  it.each([
    [95, 'Strong match'],
    [80, 'Strong match'],
    [70, 'Good match'],
    [60, 'Good match'],
    [50, 'Worth a look'],
    [40, 'Worth a look'],
    [10, 'Little in common yet'],
    [1, 'Little in common yet'],
  ])('maps %s to %s', (score, expected) => {
    expect(compatibilityLabel(score)).toBe(expected);
  });

  it('says there is not enough to go on at null (no photo evidence)', () => {
    // Null means "no shared evidence yet", not "definitely incompatible".
    expect(compatibilityLabel(null)).toBe('No match % yet');
  });
});

describe('tasteSignalFrom', () => {
  it('extracts a carryable signal from a breakdown', () => {
    const breakdown = scoreCompatibility(VIEWER, candidate(), taste(0.6));

    expect(tasteSignalFrom(breakdown)).toMatchObject({
      affinity: 0.6,
      coLikedPosts: breakdown.coLikedPosts,
    });
  });

  it('yields nothing when there was no shared evidence', () => {
    expect(tasteSignalFrom(scoreCompatibility(VIEWER, candidate()))).toBeUndefined();
  });
});