import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Gender } from '@match-makers/shared';
import {
  buildDemoCandidates,
  dateOfBirthForAge,
  DEMO_ACCOUNT_COUNT,
  DEMO_ACCOUNT_PASSWORD,
  DEMO_CITIES,
  DEMO_MAX_AGE,
  DEMO_MIN_AGE,
} from './demoSeed';

function ageOn(dateOfBirth: string, today: Date): number {
  const birthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDifference = today.getUTCMonth() - birthDate.getUTCMonth();
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

describe('live demo account seed', () => {
  const today = new Date('2026-11-17T12:00:00.000Z');
  const candidates = buildDemoCandidates(today);

  test('creates exactly twenty individually sign-in-able profiles', () => {
    assert.equal(candidates.length, DEMO_ACCOUNT_COUNT);
    assert.deepEqual(
      candidates.map((candidate) => candidate.email),
      Array.from(
        { length: DEMO_ACCOUNT_COUNT },
        (_, index) => `candidate${index + 1}@matchmakers.dev`
      )
    );
    assert.equal(DEMO_ACCOUNT_PASSWORD, 'Password1');
    assert.equal(new Set(candidates.map((candidate) => candidate.name)).size, DEMO_ACCOUNT_COUNT);
    for (const candidate of candidates) {
      assert.equal(Object.hasOwn(candidate, 'photos'), false);
    }
  });

  test('has exactly ten male and ten female profiles', () => {
    assert.equal(candidates.filter((candidate) => candidate.gender === Gender.MALE).length, 10);
    assert.equal(candidates.filter((candidate) => candidate.gender === Gender.FEMALE).length, 10);
  });

  test('covers every age from 21 through 40 with a matching date of birth', () => {
    assert.deepEqual(
      candidates.map((candidate) => candidate.age),
      Array.from({ length: DEMO_MAX_AGE - DEMO_MIN_AGE + 1 }, (_, index) => DEMO_MIN_AGE + index)
    );
    for (const candidate of candidates) {
      assert.equal(ageOn(candidate.dateOfBirth, today), candidate.age);
    }
    assert.throws(() => dateOfBirthForAge(17, today), RangeError);
  });

  test('uses only Austin, San Antonio, and Houston with real coordinates', () => {
    assert.deepEqual(
      new Set(candidates.map((candidate) => candidate.location.city)),
      new Set(DEMO_CITIES.map((city) => city.city))
    );
    assert.deepEqual(
      candidates.reduce<Record<string, number>>((counts, candidate) => {
        counts[candidate.location.city] = (counts[candidate.location.city] ?? 0) + 1;
        return counts;
      }, {}),
      { Austin: 7, 'San Antonio': 7, Houston: 6 }
    );
    for (const candidate of candidates) {
      assert.notEqual(candidate.location.latitude, 0);
      assert.notEqual(candidate.location.longitude, 0);
      assert.equal(candidate.location.country, 'United States');
    }
  });

  test('sets broad mutual preferences so the three-city pool is discoverable', () => {
    for (const candidate of candidates) {
      assert.equal(candidate.preferences.distanceMode, 'global');
      assert.deepEqual(candidate.preferences.ageRange, { min: 21, max: 40 });
      assert.deepEqual(candidate.preferences.genders, [Gender.MALE, Gender.FEMALE]);
      assert.equal(candidate.preferences.relationshipGoals.length, 5);
    }
  });
});
