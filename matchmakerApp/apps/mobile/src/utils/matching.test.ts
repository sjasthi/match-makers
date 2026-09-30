import { scoreCompatibility, compatibilityLabel } from './matching';
import { generateDemoUser, generateMockUser, ageFromDateOfBirth } from './mockData';
import { Gender, RelationshipGoal, SexualOrientation } from '@match-makers/shared';

const viewer = {
  ...generateDemoUser(),
  relationshipGoal: RelationshipGoal.LONG_TERM,
  sexualOrientation: SexualOrientation.STRAIGHT,
  preferences: {
    ageRange: { min: 24, max: 40 },
    maxDistance: 50,
    genders: [Gender.FEMALE],
    relationshipGoals: [RelationshipGoal.LONG_TERM],
  },
};

describe('ageFromDateOfBirth', () => {
  it('returns a sensible age for a birthday earlier this year', () => {
    const thisYear = new Date().getFullYear();
    expect(ageFromDateOfBirth(`${thisYear - 30}-01-01`)).toBeGreaterThanOrEqual(29);
    expect(ageFromDateOfBirth(`${thisYear - 30}-01-01`)).toBeLessThanOrEqual(30);
  });
});

describe('scoreCompatibility', () => {
  it('scores an ideal candidate at or near the maximum', () => {
    const candidate = {
      ...generateMockUser(1),
      dateOfBirth: '1995-05-20',
      gender: Gender.FEMALE,
      sexualOrientation: SexualOrientation.STRAIGHT,
      relationshipGoal: RelationshipGoal.LONG_TERM,
      isVerified: true,
    };

    const result = scoreCompatibility(viewer, candidate);
    expect(result.withinRange).toBe(true);
    expect(result.sharedGoals).toBe(true);
    expect(result.mutualOrientation).toBe(true);
    expect(result.score).toBe(100);
  });

  it('penalises a candidate outside the age range', () => {
    const candidate = {
      ...generateMockUser(2),
      dateOfBirth: '1965-01-01',
      gender: Gender.FEMALE,
      relationshipGoal: RelationshipGoal.LONG_TERM,
      sexualOrientation: SexualOrientation.STRAIGHT,
      isVerified: true,
    };

    const inRange = scoreCompatibility(viewer, {
      ...candidate,
      dateOfBirth: '1995-01-01',
    });
    const outOfRange = scoreCompatibility(viewer, candidate);

    expect(outOfRange.withinRange).toBe(false);
    expect(outOfRange.score).toBeLessThan(inRange.score);
  });

  it('ignores genders the viewer did not select', () => {
    const candidate = { ...generateMockUser(3), gender: Gender.MALE };
    const maleViewer = {
      ...viewer,
      preferences: { ...viewer.preferences, genders: [Gender.FEMALE] },
    };

    const result = scoreCompatibility(maleViewer, candidate);
    // Score is capped at 100, but the raw components are lower than a match.
    expect(result.score).toBeLessThan(100);
  });

  it('never exceeds 100', () => {
    const candidate = { ...generateMockUser(4), isVerified: true };
    expect(scoreCompatibility(viewer, candidate).score).toBeLessThanOrEqual(100);
  });
});

describe('compatibilityLabel', () => {
  it.each([
    [95, 'Strong match'],
    [70, 'Good match'],
    [50, 'Worth a look'],
    [10, 'Outside your range'],
  ])('maps %i to %s', (score, expected) => {
    expect(compatibilityLabel(score)).toBe(expected);
  });
});
