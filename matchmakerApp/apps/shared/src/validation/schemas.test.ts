import {
  loginSchema,
  passwordSchema,
  registerSchema,
  preferencesSchema,
  questionnaireSchema,
  lifestyleSchema,
  emptyLifestyle,
  MAX_IMPORTANCE,
  MAX_VALUES,
  MIN_PROMPTS,
} from './schemas';
import {
  Gender,
  RelationshipGoal,
  PartnerValue,
  PromptTag,
  PromptChoice,
  ScheduleType,
  ExerciseLevel,
  SmokingStatus,
  DrinkingStatus,
  PetsPreference,
} from '../types';

describe('loginSchema', () => {
  it('accepts a well formed payload', () => {
    const result = loginSchema.safeParse({ email: 'ada@example.com', password: 'hunter2' });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'hunter2' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'ada@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it.each([
    ['short1A', 'Password must be at least 8 characters'],
    ['alllowercase1', 'Password must contain at least one uppercase letter'],
    ['ALLUPPERCASE1', 'Password must contain at least one lowercase letter'],
    ['NoDigitsHere', 'Password must contain at least one number'],
  ])('rejects %s', (password, expectedMessage) => {
    const result = passwordSchema.safeParse(password);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(expectedMessage);
    }
  });

  it('accepts a compliant password', () => {
    expect(passwordSchema.safeParse('Str0ngPass').success).toBe(true);
  });
});

describe('registerSchema', () => {
  const base = {
    email: 'ada@example.com',
    password: 'Str0ngPass',
    confirmPassword: 'Str0ngPass',
    name: 'Ada Lovelace',
    dateOfBirth: '1990-04-12',
    gender: Gender.FEMALE,
  };

  it('accepts a matching password pair', () => {
    expect(registerSchema.safeParse(base).success).toBe(true);
  });

  it('rejects mismatched passwords and points at confirmPassword', () => {
    const result = registerSchema.safeParse({ ...base, confirmPassword: 'Different1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'confirmPassword');
      expect(issue?.message).toBe('Passwords do not match');
    }
  });

  it('rejects users under 18', () => {
    const underage = new Date();
    underage.setFullYear(underage.getFullYear() - 17);
    const result = registerSchema.safeParse({ ...base, dateOfBirth: underage.toISOString() });
    expect(result.success).toBe(false);
  });
});

describe('preferencesSchema', () => {
  const base = {
    ageRange: { min: 24, max: 38 },
    distanceMode: 'nearby' as const,
    maxDistance: 50,
    genders: [Gender.FEMALE],
    relationshipGoals: [RelationshipGoal.LONG_TERM],
  };

  it('accepts a valid range', () => {
    expect(preferencesSchema.safeParse(base).success).toBe(true);
  });

  it('accepts global mode', () => {
    expect(preferencesSchema.safeParse({ ...base, distanceMode: 'global' }).success).toBe(true);
  });

  it('rejects a distance mode it does not know', () => {
    // A typo has to fail here rather than being dropped, because a preference
    // silently reverted to a default is worse than one rejected outright.
    const result = preferencesSchema.safeParse({ ...base, distanceMode: 'anywhere' });
    expect(result.success).toBe(false);
  });

  it('still validates the radius while global, so a round trip survives', () => {
    // The radius is carried through global mode precisely so switching back to
    // nearby restores it. Rejecting it while hidden would make a profile fail
    // on a field the person cannot see.
    expect(
      preferencesSchema.safeParse({ ...base, distanceMode: 'global', maxDistance: 0 }).success
    ).toBe(false);
    expect(preferencesSchema.safeParse({ ...base, distanceMode: 'global' }).success).toBe(true);
  });

  it('rejects an inverted age range', () => {
    const result = preferencesSchema.safeParse({ ...base, ageRange: { min: 40, max: 30 } });
    expect(result.success).toBe(false);
  });

  it('requires at least one gender', () => {
    const result = preferencesSchema.safeParse({ ...base, genders: [] });
    expect(result.success).toBe(false);
  });
});

describe('lifestyleSchema', () => {
  const base = {
    schedule: ScheduleType.EARLY_BIRD,
    exercise: ExerciseLevel.MODERATE,
    smoking: SmokingStatus.NEVER,
    drinking: DrinkingStatus.SOCIALLY,
    pets: PetsPreference.LOVE_PETS,
  };

  it('accepts a full set of answers', () => {
    expect(lifestyleSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a missing question', () => {
    const { pets: _pets, ...withoutPets } = base;
    expect(lifestyleSchema.safeParse(withoutPets).success).toBe(false);
  });

  it('produces a valid draft from emptyLifestyle', () => {
    expect(lifestyleSchema.safeParse(emptyLifestyle()).success).toBe(true);
  });
});

describe('questionnaireSchema', () => {
  const base = {
    values: [PartnerValue.KINDNESS, PartnerValue.SENSE_OF_HUMOUR],
    importance: { [PartnerValue.KINDNESS]: 5, [PartnerValue.SENSE_OF_HUMOUR]: 3 },
    dealBreakers: [PartnerValue.KINDNESS],
    prompts: [
      { promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.YES },
      { promptId: 'leisure', tag: PromptTag.LEISURE, choice: PromptChoice.SOMETIMES },
    ],
    lifestyle: emptyLifestyle(),
  };

  it('accepts a complete answer set', () => {
    expect(questionnaireSchema.safeParse(base).success).toBe(true);
  });

  it('requires at least one value', () => {
    expect(questionnaireSchema.safeParse({ ...base, values: [] }).success).toBe(false);
  });

  it('requires enough prompts for the score to mean something', () => {
    expect(questionnaireSchema.safeParse({ ...base, prompts: [] }).success).toBe(false);
    const tooFew = base.prompts.slice(0, MIN_PROMPTS - 1);
    expect(questionnaireSchema.safeParse({ ...base, prompts: tooFew }).success).toBe(false);
  });

  it('rejects a prompt tag it does not know, so a typo cannot reach the engine', () => {
    const result = questionnaireSchema.safeParse({
      ...base,
      prompts: [{ promptId: 'x', tag: 'knitting', choice: PromptChoice.YES }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects two answers to the same prompt', () => {
    const result = questionnaireSchema.safeParse({
      ...base,
      prompts: [
        { promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.YES },
        { promptId: 'family-again', tag: PromptTag.FAMILY, choice: PromptChoice.NO },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['prompts']);
    }
  });

  it('keeps a free text note unscored but stored', () => {
    const result = questionnaireSchema.safeParse({
      ...base,
      prompts: [{ ...base.prompts[0], note: 'Two cats, no dogs.' }, base.prompts[1]],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompts[0]?.note).toBe('Two cats, no dogs.');
    }
  });

  it('caps how many values can be picked', () => {
    const values = Object.values(PartnerValue).slice(0, MAX_VALUES + 1);
    const importance = Object.fromEntries(values.map((value) => [value, 3]));
    const result = questionnaireSchema.safeParse({ ...base, values, importance, dealBreakers: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a value that was never given an importance rating', () => {
    const result = questionnaireSchema.safeParse({
      ...base,
      importance: { [PartnerValue.KINDNESS]: 5 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['importance']);
    }
  });

  it('rejects an importance outside the 1 to 5 scale', () => {
    const tooHigh = MAX_IMPORTANCE + 1;
    const result = questionnaireSchema.safeParse({
      ...base,
      importance: { ...base.importance, [PartnerValue.KINDNESS]: tooHigh },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a deal breaker that is not one of the chosen values', () => {
    const result = questionnaireSchema.safeParse({
      ...base,
      dealBreakers: [PartnerValue.AMBITION],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['dealBreakers']);
    }
  });
});
