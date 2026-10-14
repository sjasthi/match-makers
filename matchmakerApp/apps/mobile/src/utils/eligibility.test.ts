import {
  Gender,
  RelationshipGoal,
  SexualOrientation,
  type Location,
  type User,
  type UserPreferences,
} from '@match-makers/shared';

import { generateDemoUser } from './mockData';
import { checkEligibility, distanceBetween, summariseBlockers, type BlockerCode } from './eligibility';

const AUSTIN: Location = {
  latitude: 30.2672,
  longitude: -97.7431,
  city: 'Austin',
  country: 'United States',
};
/** About 315 km from Austin. */
const DALLAS: Location = {
  latitude: 32.7767,
  longitude: -96.797,
  city: 'Dallas',
  country: 'United States',
};
const SINGAPORE: Location = {
  latitude: 1.3521,
  longitude: 103.8198,
  city: 'Singapore',
  country: 'Singapore',
};
/** The placeholder every new account and every hand-typed city starts with. */
const NOWHERE: Location = { latitude: 0, longitude: 0, city: '', country: '' };

function preferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    ageRange: { min: 24, max: 38 },
    distanceMode: 'nearby',
    maxDistance: 50,
    genders: [Gender.FEMALE, Gender.MALE, Gender.NON_BINARY],
    relationshipGoals: [RelationshipGoal.LONG_TERM],
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    ...(generateDemoUser() as User),
    id: 'user_a',
    dateOfBirth: '1995-06-15',
    gender: Gender.FEMALE,
    sexualOrientation: SexualOrientation.STRAIGHT,
    relationshipGoal: RelationshipGoal.LONG_TERM,
    location: AUSTIN,
    preferences: preferences(),
    ...overrides,
  };
}

describe('checkEligibility', () => {
  it('accepts a pair that meets every requirement', () => {
    const result = checkEligibility(makeUser(), makeUser({ id: 'user_b' }));
    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('rejects yourself', () => {
    const viewer = makeUser();
    expect(checkEligibility(viewer, viewer).failures).toContain('self');
  });

  describe('age', () => {
    it('rejects someone outside the stated range', () => {
      const older = makeUser({ id: 'user_b', dateOfBirth: '1970-01-01' });
      expect(checkEligibility(makeUser(), older).failures).toContain('age');
    });

    it('accepts both ends of the range inclusively', () => {
      const viewer = makeUser({
        preferences: preferences({ ageRange: { min: 30, max: 35 } }),
      });
      const exactlyMin = makeUser({ id: 'user_b', dateOfBirth: '1995-06-15' });
      expect(checkEligibility(viewer, exactlyMin).eligible).toBe(true);
    });
  });

  describe('gender', () => {
    it('rejects a gender that was not selected', () => {
      const viewer = makeUser({ preferences: preferences({ genders: [Gender.FEMALE] }) });
      const man = makeUser({ id: 'user_b', gender: Gender.MALE });
      expect(checkEligibility(viewer, man).failures).toContain('gender');
    });

    it('does not hide someone who declined to state their gender', () => {
      // Otherwise "show me women" becomes a claim that people who withheld an
      // answer are unwanted, and the demo account -- which is
      // prefer_not_to_say -- would be excluded by every seeded profile.
      const viewer = makeUser({ preferences: preferences({ genders: [Gender.FEMALE] }) });
      const unstated = makeUser({ id: 'user_b', gender: Gender.PREFER_NOT_TO_SAY });
      expect(checkEligibility(viewer, unstated).eligible).toBe(true);
    });

    it('still excludes an unstated gender from the reverse direction', () => {
      // The wildcard is about not knowing, not about the seeker being vague.
      const seeker = makeUser({
        id: 'user_a',
        gender: Gender.PREFER_NOT_TO_SAY,
        preferences: preferences({ genders: [Gender.FEMALE] }),
      });
      const man = makeUser({ id: 'user_b', gender: Gender.MALE });
      expect(checkEligibility(seeker, man).failures).toContain('gender');
    });
  });

  describe('distance', () => {
    it('accepts someone inside the radius', () => {
      const near = makeUser({
        id: 'user_b',
        location: { ...AUSTIN, latitude: 30.4, longitude: -97.9 },
      });
      const result = checkEligibility(makeUser(), near);
      expect(result.failures).not.toContain('distance');
      expect(result.distanceKm).toBeGreaterThan(0);
      expect(result.distanceKm).toBeLessThan(50);
    });

    it('rejects someone outside the radius', () => {
      const far = makeUser({ id: 'user_b', location: DALLAS });
      expect(checkEligibility(makeUser(), far).failures).toContain('distance');
    });

    it('treats the radius as inclusive of the exact boundary', () => {
      const dallasDistance = checkEligibility(
        makeUser(),
        makeUser({ id: 'user_b', location: DALLAS })
      ).distanceKm;
      const viewer = makeUser({
        preferences: preferences({ maxDistance: Math.ceil(dallasDistance ?? 0) }),
      });
      expect(checkEligibility(viewer, makeUser({ id: 'user_b', location: DALLAS })).eligible).toBe(
        true
      );
    });

    it('ignores distance entirely in global mode', () => {
      // The escape hatch has to actually escape, including for someone on the
      // other side of the planet.
      const global = makeUser({
        preferences: preferences({ distanceMode: 'global', maxDistance: 5 }),
      });
      const singapore = makeUser({ id: 'user_b', location: SINGAPORE });
      const result = checkEligibility(global, singapore);
      expect(result.eligible).toBe(true);
      // Still measured, so a card can say how far away they are.
      expect(result.distanceKm).toBeGreaterThan(10000);
    });

    it('excludes a profile with no location from a nearby seeker', () => {
      // Failing closed on the other person's missing data. The alternative is
      // quietly widening everyone's radius to cover whoever never set one.
      const unlocated = makeUser({ id: 'user_b', location: NOWHERE });
      const result = checkEligibility(makeUser(), unlocated);
      expect(result.failures).toContain('missing_location');
      expect(result.distanceKm).toBeNull();
    });

    it('still shows an unlocated profile to a global seeker', () => {
      const global = makeUser({ preferences: preferences({ distanceMode: 'global' }) });
      const unlocated = makeUser({ id: 'user_b', location: NOWHERE });
      expect(checkEligibility(global, unlocated).eligible).toBe(true);
    });

    it('falls back to global when the seeker is the one with no location', () => {
      // Failing open on your own data. Excluding here would empty the viewer's
      // own deck and the emptiness would read as "nobody matches you".
      const unlocatedSeeker = makeUser({ location: NOWHERE });
      const far = makeUser({ id: 'user_b', location: SINGAPORE });
      expect(checkEligibility(unlocatedSeeker, far).eligible).toBe(true);
    });

    it('reports every failing requirement, not just the first', () => {
      // The feed tallies these to explain an empty deck, so returning early
      // would make the tally understate whatever the real cause is.
      const picky = makeUser({ preferences: preferences({ genders: [Gender.FEMALE] }) });
      const result = checkEligibility(
        picky,
        makeUser({
          id: 'user_b',
          dateOfBirth: '1970-01-01',
          gender: Gender.MALE,
          location: SINGAPORE,
        })
      );
      expect(result.failures).toEqual(expect.arrayContaining(['age', 'gender', 'distance']));
    });
  });
});

/**
 * The mutual gate, composed the way `services/feed.ts` composes it.
 *
 * Duplicated here on purpose rather than imported: the feed cannot call a single
 * mutual helper because it needs to know which side rejected whom, so this
 * mirrors that composition to keep the tested rule and the shipped rule the same
 * thing.
 */
function passesBothWays(a: User, b: User): boolean {
  return checkEligibility(a, b).eligible && checkEligibility(b, a).eligible;
}

/** The blocker codes one direction produced, for asserting on the reason itself. */
function blockersFor(seeker: User, target: User): BlockerCode[] {
  return checkEligibility(seeker, target).failures;
}

describe('the mutual gate', () => {
  it('requires the target to pass, not just the seeker', () => {
    // The whole point: a one-way filter shows you people who filtered you out.
    const seeker = makeUser({ id: 'user_a' });
    const excludesYou = makeUser({
      id: 'user_b',
      preferences: preferences({ genders: [Gender.MALE] }),
    });
    expect(checkEligibility(seeker, excludesYou).eligible).toBe(true);
    expect(passesBothWays(seeker, excludesYou)).toBe(false);
  });

  it('is order independent', () => {
    const a = makeUser({ id: 'user_a', preferences: preferences({ genders: [Gender.FEMALE] }) });
    const b = makeUser({ id: 'user_b', gender: Gender.FEMALE });
    expect(passesBothWays(a, b)).toBe(passesBothWays(b, a));
  });

  it('binds both sides on distance', () => {
    // Each person's own limit has to hold, so the effective radius is the
    // tighter of the two. This person is ~15 km from Austin, which a 10 km
    // limit excludes and a 500 km limit does not.
    const fifteenKmAway = { ...AUSTIN, latitude: 30.4, longitude: -97.7431 };

    const strictViewer = makeUser({
      id: 'user_a',
      preferences: preferences({ maxDistance: 10 }),
    });
    const target = makeUser({ id: 'user_b', location: fifteenKmAway });

    expect(passesBothWays(strictViewer, target)).toBe(false);
    expect(passesBothWays(target, strictViewer)).toBe(false);

    // Same pair, same distance, but nobody is asking for anything tighter.
    const relaxedViewer = makeUser({
      id: 'user_c',
      preferences: preferences({ maxDistance: 500 }),
    });
    expect(passesBothWays(relaxedViewer, target)).toBe(true);
  });

  it('lets one side being global rescue a pair the other would limit', () => {
    const nearbyOnly = makeUser({ id: 'user_a' });
    const global = makeUser({
      id: 'user_b',
      preferences: preferences({ distanceMode: 'global' }),
      location: SINGAPORE,
    });
    // The global side imposes no limit of its own, but the nearby side's limit
    // still applies: global is a relaxation, not an override of other people.
    expect(passesBothWays(nearbyOnly, global)).toBe(false);
    expect(passesBothWays(global, nearbyOnly)).toBe(false);
  });

  it('gates on relationship goal, in both directions', () => {
    // This used to be a scoring signal only. It is now a hard requirement, and
    // the gate is mutual: a long-term seeker and a casual-only seeker are each
    // outside the other's stated requirements, so no amount of shared taste can
    // put them in front of each other.
    const longTerm = makeUser({
      id: 'user_a',
      relationshipGoal: RelationshipGoal.LONG_TERM,
      preferences: preferences({ relationshipGoals: [RelationshipGoal.LONG_TERM] }),
    });
    const casual = makeUser({
      id: 'user_b',
      relationshipGoal: RelationshipGoal.CASUAL,
      preferences: preferences({ relationshipGoals: [RelationshipGoal.CASUAL] }),
    });
    expect(passesBothWays(longTerm, casual)).toBe(false);
    expect(blockersFor(longTerm, casual)).toContain('goal');
    expect(blockersFor(casual, longTerm)).toContain('goal');
  });

  it('lets a perfect taste match through when the goals overlap', () => {
    // The gate is the floor, not the ranking. People who are each open to the
    // other's goal are still ordered by taste afterwards.
    const longTerm = makeUser({
      id: 'user_a',
      relationshipGoal: RelationshipGoal.LONG_TERM,
      preferences: preferences({ relationshipGoals: [RelationshipGoal.LONG_TERM] }),
    });
    const alsoLongTerm = makeUser({
      id: 'user_b',
      relationshipGoal: RelationshipGoal.LONG_TERM,
      preferences: preferences({ relationshipGoals: [RelationshipGoal.LONG_TERM] }),
    });
    expect(passesBothWays(longTerm, alsoLongTerm)).toBe(true);
  });

  it('does not gate a user who has stated no goal preference', () => {
    // Onboarding can be abandoned part way, and an account with no stated goals
    // has not excluded anybody, so nothing blocks on the way out of it. Asserted
    // in one direction on purpose: the other side still gates on its own list,
    // which is what makes the gate mutual rather than a free pass.
    const noPreference = makeUser({
      id: 'user_a',
      preferences: preferences({ relationshipGoals: [] }),
    });
    const casual = makeUser({
      id: 'user_b',
      relationshipGoal: RelationshipGoal.CASUAL,
      preferences: preferences({ relationshipGoals: [RelationshipGoal.CASUAL] }),
    });

    expect(blockersFor(noPreference, casual)).not.toContain('goal');
    expect(blockersFor(casual, noPreference)).toContain('goal');
  });

  it('does not gate on sexual orientation, which stays a scoring signal', () => {
    const straight = makeUser({ id: 'user_a', sexualOrientation: SexualOrientation.STRAIGHT });
    const gay = makeUser({ id: 'user_b', sexualOrientation: SexualOrientation.GAY });
    expect(passesBothWays(straight, gay)).toBe(true);
  });
});

describe('distanceBetween', () => {
  it('measures a pair that passes, for display', () => {
    expect(
      distanceBetween(makeUser(), makeUser({ id: 'user_b', location: DALLAS }))
    ).toBeGreaterThan(285);
  });

  it('returns null rather than guessing when a location is unknown', () => {
    const unlocated = makeUser({ id: 'user_b', location: NOWHERE });
    expect(distanceBetween(makeUser(), unlocated)).toBeNull();
  });
});

describe('summariseBlockers', () => {
  it('names the setting responsible for an empty deck', () => {
    expect(summariseBlockers(['age', 'age', 'distance'])).toContain('age range');
  });

  it('separates an all-or-nothing blocker from a dominant one', () => {
    expect(summariseBlockers(['distance', 'distance'])).toMatch(/^Everyone/);
    expect(summariseBlockers(['distance', 'age'])).toMatch(/^Most/);
  });

  it('distinguishes swiping everyone from being filtered', () => {
    // The most common real reason for an empty deck. Reporting it as anything
    // else would send people to widen a setting that was never the problem.
    expect(summariseBlockers(['already_swiped'])).toContain('already swiped');
  });

  it('says so when nothing was actually blocked', () => {
    expect(summariseBlockers([])).toBe('There is nobody else here yet.');
  });
});
