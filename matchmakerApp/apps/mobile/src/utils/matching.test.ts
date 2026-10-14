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
  it('is dominated by shared taste', () => {
    const base = scoreCompatibility(VIEWER, candidate());
    const boosted = scoreCompatibility(VIEWER, candidate(), taste(1));

    // Taste owns 80 of 100. That is the inversion of FP3, where a stated
    // questionnaire owned 45 and the photo feed was worth 10.
    expect(MATCH_WEIGHTS.sharedTaste).toBe(80);
    expect(boosted.score - base.score).toBeGreaterThanOrEqual(MATCH_WEIGHTS.sharedTaste - 2);
  });

  it('scores exactly as before when there is no taste signal', () => {
    expect(scoreCompatibility(VIEWER, candidate())).toEqual(
      scoreCompatibility(VIEWER, candidate(), {
        affinity: 0,
        coLikedPosts: 0,
        sharedTags: [],
        reason: null,
      })
    );
  });

  it('never passes 100', () => {
    const perfect = scoreCompatibility(VIEWER, candidate(), taste(1));
    expect(perfect.score).toBeLessThanOrEqual(100);
  });

  it('cannot reach a strong match on taste alone', () => {
    // `coLikeOverlap` is `n / (n + 2)`, which approaches but never reaches 1, so
    // the achievable taste total is strictly under 80. That is the only thing
    // stopping a behavioural signal from reading as "Strong match" on its own,
    // which matters because taste must not be able to overrule what somebody said
    // they were looking for.
    const bare = {
      ...VIEWER,
      relationshipGoal: RelationshipGoal.NOT_SURE,
      sexualOrientation: SexualOrientation.PREFER_NOT_TO_SAY,
      isVerified: false,
    };
    // Maximally distant goals: rank 0 against rank 3, which earns nothing at all.
    const opposing = {
      ...candidate(),
      relationshipGoal: RelationshipGoal.LONG_TERM,
      sexualOrientation: SexualOrientation.ASEXUAL,
      isVerified: false,
    };

    const ceiling = scoreCompatibility(bare, opposing, taste(0.99));

    expect(ceiling.score).toBeLessThan(80);
    expect(compatibilityLabel(ceiling.score)).not.toBe('Strong match');
  });

  it('gives the same stated goal full points and opposite goals none', () => {
    // A ramp, not equality: `not_sure` against `long_term` is the widest gap the
    // ranking has and earns nothing, while `long_term` against `casual` is closer
    // and earns something. Only the identical pair takes the full weight.
    const same = scoreCompatibility(
      VIEWER,
      candidate({ relationshipGoal: RelationshipGoal.LONG_TERM })
    );
    const opposite = scoreCompatibility(
      VIEWER,
      candidate({ relationshipGoal: RelationshipGoal.NOT_SURE })
    );

    expect(same.sharedGoals).toBe(true);
    expect(opposite.sharedGoals).toBe(false);
    expect(same.score - opposite.score).toBe(MATCH_WEIGHTS.relationshipGoal);
  });

  it('gives compatible orientation points', () => {
    const same = scoreCompatibility(VIEWER, candidate());
    const different = scoreCompatibility(
      VIEWER,
      candidate({ sexualOrientation: SexualOrientation.ASEXUAL })
    );

    expect(same.mutualOrientation).toBe(true);
    expect(different.mutualOrientation).toBe(false);
    expect(same.score - different.score).toBe(MATCH_WEIGHTS.mutualOrientation);
  });

  it('gives a verified profile points', () => {
    const verified = scoreCompatibility(VIEWER, candidate({ isVerified: true }));
    const not = scoreCompatibility(VIEWER, candidate({ isVerified: false }));

    expect(verified.score - not.score).toBe(MATCH_WEIGHTS.verified);
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
    // The cold-start case the "building up" strip exists to explain. It is
    // honest that it is degenerate rather than pretending a stale questionnaire
    // is still standing in for evidence.
    const first = scoreCompatibility(VIEWER, candidate({ id: 'a' }));
    const second = scoreCompatibility(
      VIEWER,
      candidate({ id: 'b', relationshipGoal: RelationshipGoal.LONG_TERM })
    );

    expect(first.score).toBe(second.score);
  });

  it('does not penalise or reward age, gender or distance any more', () => {
    // All three are hard eligibility rules in `utils/eligibility.ts`. They used to
    // be worth 20 points *as well*, which counted the same filter twice.
    const inRange = scoreCompatibility(VIEWER, candidate({ dateOfBirth: '1995-05-20' }));
    const outOfRange = scoreCompatibility(VIEWER, candidate({ dateOfBirth: '1970-01-01' }));

    expect(inRange.score).toBe(outOfRange.score);
  });

  it('has no deal-breaker veto left', () => {
    // Confirmed as acceptable when the questionnaire went. Stated as a test so a
    // future change that reintroduces a veto has to say so deliberately.
    expect('dealBreakerClash' in scoreCompatibility(VIEWER, candidate())).toBe(false);
  });
});

describe('against real seeded data', () => {
  it('orders a deck by taste when taste exists', () => {
    const viewer = VIEWER;
    const others = generateMockUsers(8) as User[];
    const posts = generateSeedPosts(24);
    // The viewer needs reactions too. In the app the demo account starts with
    // none on purpose - their taste is whatever they answer - so a test that
    // only seeded the candidates would be measuring the cold-start case.
    const reactions = seedReactionsFor([viewer, ...others], posts);
    const index = buildTasteIndex(reactions, posts);

    // Built the way the feed builds it, so this exercises the real signal path
    // rather than only a hand-written fixture.
    const scored = others.map((user) =>
      scoreCompatibility(viewer, user, tasteBetween(index, viewer.id, user.id))
    );

    // Seeded candidates carry reactions, so the signal is live against real rows.
    expect(scored.some((result) => result.tasteAffinity > 0)).toBe(true);
    for (const result of scored) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it('keeps a liked pair above an unliked one holding everything else equal', () => {
    const other = generateMockUser(3) as User;
    const withoutTaste = scoreCompatibility(VIEWER, other);
    const withTaste = scoreCompatibility(VIEWER, other, taste(0.6));

    expect(withTaste.score).toBeGreaterThan(withoutTaste.score);
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

  it('says there is not enough to go on at zero', () => {
    // Zero means "no shared evidence yet", not "definitely incompatible". The
    // wording has to keep that difference, because the deck shows zeroes to
    // everyone who has not answered any photos.
    expect(compatibilityLabel(0)).toBe('Not enough to go on');
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