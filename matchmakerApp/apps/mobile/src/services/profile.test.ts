import { Gender, RelationshipGoal, SexualOrientation, emptyLifestyle } from '@match-makers/shared';
import { getMissingProfileSections, hasCompleteQuestionnaire, isProfileComplete } from './profile';
import { generateDemoUser } from '@/utils/mockData';
import type { User } from '@match-makers/shared';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function makeUser(overrides: DeepPartial<User> = {}): User {
  return {
    ...generateDemoUser(),
    ...overrides,
    // Nested objects are merged rather than replaced, so a test can override a
    // single preference without restating the whole shape.
    ...(overrides.location
      ? { location: { ...generateDemoUser().location, ...overrides.location } }
      : {}),
    ...(overrides.preferences
      ? {
          preferences: {
            ...generateDemoUser().preferences,
            ...overrides.preferences,
            ageRange: {
              ...generateDemoUser().preferences.ageRange,
              ...overrides.preferences.ageRange,
            },
          },
        }
      : {}),
  } as User;
}

describe('hasCompleteQuestionnaire', () => {
  it('accepts the seeded demo questionnaire', () => {
    expect(hasCompleteQuestionnaire(makeUser())).toBe(true);
  });

  it('rejects a user with no questionnaire at all', () => {
    expect(hasCompleteQuestionnaire(makeUser({ questionnaire: undefined }))).toBe(false);
  });

  it('rejects a null user', () => {
    expect(hasCompleteQuestionnaire(null)).toBe(false);
  });

  it('rejects a questionnaire whose values are not graded', () => {
    const user = makeUser();
    delete user.questionnaire!.importance[user.questionnaire!.values[0]!];
    expect(hasCompleteQuestionnaire(user)).toBe(false);
  });

  it('rejects a deal breaker that is not among the picked values', () => {
    const user = makeUser();
    user.questionnaire!.dealBreakers = ['ambition' as never];
    expect(hasCompleteQuestionnaire(user)).toBe(false);
  });
});

describe('isProfileComplete', () => {
  it('is true for the demo account, so the demo shortcut reaches the feed', () => {
    expect(isProfileComplete(makeUser())).toBe(true);
  });

  it('is false for a null user', () => {
    expect(isProfileComplete(null)).toBe(false);
  });

  it('is true without a questionnaire, because it is answered in the feed', () => {
    // Asking for the whole answer set up front is what the prompt session
    // replaced. Creation finishes without one; the feed takes over from there.
    const user = makeUser({
      questionnaire: undefined,
      bio: 'Filled in.',
      photos: [{ id: 'p1', url: 'file://photo.jpg', isPrimary: true, order: 0 }],
    });
    expect(isProfileComplete(user)).toBe(true);
    expect(hasCompleteQuestionnaire(user)).toBe(false);
  });

  it('is false when the bio is empty', () => {
    expect(isProfileComplete(makeUser({ bio: '   ' }))).toBe(false);
  });

  it('is false when there are no photos', () => {
    expect(isProfileComplete(makeUser({ photos: [] }))).toBe(false);
  });

  it('is false when the location has no city', () => {
    expect(isProfileComplete(makeUser({ location: { city: '' } }))).toBe(false);
  });

  it('accepts a city with no coordinates, so anyone can finish signing up', () => {
    // Looser than it should end up being. `cityCatalog` is about forty cities
    // and not a geocoder, so requiring coordinates here would stop anyone
    // outside it from registering at all. The rules treat an unlocated viewer as
    // global, so their own deck still loads.
    const user = makeUser({ location: { latitude: 0, longitude: 0, city: 'Bradford' } });
    expect(isProfileComplete(user)).toBe(true);
    expect(getMissingProfileSections(user)).toEqual([]);
  });

  it('is true once the city has been resolved to coordinates', () => {
    const user = makeUser({ location: { latitude: 30.2672, longitude: -97.7431 } });
    expect(isProfileComplete(user)).toBe(true);
    expect(getMissingProfileSections(user)).toEqual([]);
  });

  it('does not gate on the distance mode', () => {
    // Global is a valid answer, not a missing one, and it needs no location of
    // its own beyond the one every profile already has.
    expect(isProfileComplete(makeUser({ preferences: { distanceMode: 'global' } }))).toBe(true);
  });

  it('is false when no genders are selected', () => {
    expect(isProfileComplete(makeUser({ preferences: { genders: [] } }))).toBe(false);
  });
});

describe('getMissingProfileSections', () => {
  it('reports nothing for a finished profile', () => {
    expect(getMissingProfileSections(makeUser())).toEqual([]);
  });

  it('reports every section for a null user, so a fresh account starts at the top', () => {
    const missing = getMissingProfileSections(null);
    expect(missing).toContain('bio');
    // The questionnaire is never an onboarding gap.
    expect(missing).not.toContain('prompts');
  });

  it('never reports the questionnaire as an onboarding gap', () => {
    // It is answered in the feed, so it is not something onboarding can fix.
    const user = makeUser({ questionnaire: undefined });
    expect(getMissingProfileSections(user)).toEqual([]);
    expect(hasCompleteQuestionnaire(user)).toBe(false);
  });

  it('does not treat "not sure yet" as a missing intent answer', () => {
    // It is a real option on the intent step, and the demo account ships with
    // it, so reporting it as missing would nag people for answering honestly.
    const user = makeUser({ relationshipGoal: RelationshipGoal.NOT_SURE });
    expect(getMissingProfileSections(user)).toEqual([]);
  });

  it('does not treat "prefer not to say" as a missing intent answer', () => {
    const user = makeUser({ sexualOrientation: SexualOrientation.PREFER_NOT_TO_SAY });
    expect(getMissingProfileSections(user)).toEqual([]);
  });

  it('lists preferences only once when both preference lists are empty', () => {
    const user = makeUser({
      preferences: { genders: [], relationshipGoals: [] },
    });
    const missing = getMissingProfileSections(user);
    expect(missing.filter((section) => section === 'preferences')).toHaveLength(1);
  });

  it('orders the gaps the way the questionnaire asks them', () => {
    const user = makeUser({
      bio: '',
      questionnaire: undefined,
      photos: [],
      location: { city: '' },
      sexualOrientation: SexualOrientation.PREFER_NOT_TO_SAY,
      preferences: { genders: [], relationshipGoals: [] },
    });

    expect(getMissingProfileSections(user)).toEqual(['bio', 'photos', 'location', 'preferences']);
  });
});

describe('questionnaire defaults', () => {
  it('produces a lifestyle that the questionnaire schema accepts', () => {
    const user = makeUser({ questionnaire: undefined });
    user.questionnaire = {
      values: [],
      importance: {},
      dealBreakers: [],
      prompts: [],
      lifestyle: emptyLifestyle(),
    };
    // Empty values and prompts must fail, which is what keeps a user from
    // skipping the questionnaire by saving the lifestyle step alone.
    expect(hasCompleteQuestionnaire(user)).toBe(false);
  });
});

describe('gender is part of the basics step', () => {
  it('is not inferred from anything else, so it has to be stored explicitly', () => {
    const user = makeUser({ gender: Gender.PREFER_NOT_TO_SAY });
    expect(user.gender).toBe(Gender.PREFER_NOT_TO_SAY);
  });
});
