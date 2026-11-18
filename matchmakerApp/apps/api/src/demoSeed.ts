import {
  Gender,
  RelationshipGoal,
  SexualOrientation,
  type Location,
  type UserPreferences,
} from '@match-makers/shared';

/** Shared credentials are intentionally only for local/demo accounts. */
export const DEMO_ACCOUNT_PASSWORD = 'Password1';
export const DEMO_ACCOUNT_COUNT = 20;
export const DEMO_MIN_AGE = 21;
export const DEMO_MAX_AGE = 40;

export type DemoCity = Location;

/**
 * The three demo locations. Coordinates are city centroids, not precise
 * addresses, and match the mobile app's current city catalog.
 */
export const DEMO_CITIES: readonly DemoCity[] = [
  { city: 'Austin', country: 'United States', latitude: 30.2672, longitude: -97.7431 },
  { city: 'San Antonio', country: 'United States', latitude: 29.4241, longitude: -98.4936 },
  { city: 'Houston', country: 'United States', latitude: 29.7604, longitude: -95.3698 },
];

const IDENTITIES: ReadonlyArray<{ name: string; gender: Gender }> = [
  { name: 'Amara Okafor', gender: Gender.FEMALE },
  { name: 'Jonas Lindqvist', gender: Gender.MALE },
  { name: 'Priya Raman', gender: Gender.FEMALE },
  { name: 'Mateo Alvarez', gender: Gender.MALE },
  { name: 'Zara Haddad', gender: Gender.FEMALE },
  { name: 'Ellis Whitmore', gender: Gender.MALE },
  { name: 'Nadia Kovacs', gender: Gender.FEMALE },
  { name: 'Rowan Bennett', gender: Gender.MALE },
  { name: 'Hana Sato', gender: Gender.FEMALE },
  { name: 'Tobias Sorensen', gender: Gender.MALE },
  { name: 'Amina Diallo', gender: Gender.FEMALE },
  { name: 'Rafael Ferreira', gender: Gender.MALE },
  { name: 'Sinead Byrne', gender: Gender.FEMALE },
  { name: 'Kenji Tanaka', gender: Gender.MALE },
  { name: 'Lucia Moreau', gender: Gender.FEMALE },
  { name: 'Dmitri Volkov', gender: Gender.MALE },
  { name: 'Noor Rahman', gender: Gender.FEMALE },
  { name: 'Felix Baumann', gender: Gender.MALE },
  { name: 'Thandi Mokoena', gender: Gender.FEMALE },
  { name: 'Omar Haddadi', gender: Gender.MALE },
];

const ALL_GOALS: readonly RelationshipGoal[] = [
  RelationshipGoal.LONG_TERM,
  RelationshipGoal.SHORT_TERM,
  RelationshipGoal.CASUAL,
  RelationshipGoal.FRIENDSHIP,
  RelationshipGoal.NOT_SURE,
];

export interface DemoCandidate {
  email: string;
  name: string;
  age: number;
  dateOfBirth: string;
  gender: Gender;
  sexualOrientation: SexualOrientation;
  relationshipGoal: RelationshipGoal;
  bio: string;
  location: Location;
  preferences: UserPreferences;
}

/**
 * Generates the requested ages relative to the seed date, instead of letting
 * the demo accounts gradually drift outside the 21–40 range. Birthdays are
 * placed at least a week before the seed date to avoid timezone-boundary age
 * changes in clients that parse a date-only ISO value as UTC.
 */
export function dateOfBirthForAge(age: number, today = new Date()): string {
  if (!Number.isInteger(age) || age < 18 || age > 100) {
    throw new RangeError('Demo age must be a whole number between 18 and 100');
  }

  const birthDate = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  birthDate.setUTCFullYear(birthDate.getUTCFullYear() - age);
  birthDate.setUTCDate(birthDate.getUTCDate() - 7 - (age % 14));
  return birthDate.toISOString().slice(0, 10);
}

/**
 * Stable candidate profiles for the live API demo.
 *
 * One profile is created at each age from 21 through 40. Genders alternate so
 * the final set contains exactly ten men and ten women, and locations rotate
 * evenly across the three supported cities. Permissive preferences and a
 * wildcard orientation keep the demo profiles mutually discoverable.
 */
export function buildDemoCandidates(today = new Date()): DemoCandidate[] {
  return IDENTITIES.map((identity, index) => {
    const age = DEMO_MIN_AGE + index;
    const city = DEMO_CITIES[index % DEMO_CITIES.length];
    if (!city) throw new Error('Demo city list is empty');

    return {
      email: `candidate${index + 1}@matchmakers.dev`,
      name: identity.name,
      age,
      dateOfBirth: dateOfBirthForAge(age, today),
      gender: identity.gender,
      sexualOrientation: SexualOrientation.PREFER_NOT_TO_SAY,
      relationshipGoal: RelationshipGoal.NOT_SURE,
      bio: `Demo profile for match testing. Usually in ${city.city}.`,
      location: { ...city },
      preferences: {
        ageRange: { min: DEMO_MIN_AGE, max: DEMO_MAX_AGE },
        distanceMode: 'global',
        maxDistance: 500,
        genders: [Gender.MALE, Gender.FEMALE],
        relationshipGoals: [...ALL_GOALS],
      },
    };
  });
}
