import type { User } from '@match-makers/shared';
import {
  questionnaireSchema,
  MAX_VALUES,
  MIN_PROMPTS,
  MIN_IMPORTANCE,
  MAX_IMPORTANCE,
} from '@match-makers/shared';
import { generateMockUsers, generateDemoUser } from './mockData';
import { findCityCentroid } from './cityCatalog';
import { distanceKm, hasCoordinates } from './distance';

describe('seeded questionnaire data', () => {
  const candidates = generateMockUsers(40);

  it('gives every candidate a questionnaire the shared schema accepts', () => {
    const invalid = candidates.filter(
      (user) => !questionnaireSchema.safeParse(user.questionnaire).success
    );
    expect(invalid.map((user) => user.id)).toEqual([]);
  });

  it('rates every value a candidate selected', () => {
    for (const user of candidates) {
      const { values, importance } = user.questionnaire!;
      for (const value of values) {
        expect(importance[value]).toBeDefined();
      }
    }
  });

  it('keeps importance inside the advertised scale', () => {
    for (const user of candidates) {
      for (const rating of Object.values(user.questionnaire!.importance)) {
        expect(rating).toBeGreaterThanOrEqual(MIN_IMPORTANCE);
        expect(rating).toBeLessThanOrEqual(MAX_IMPORTANCE);
      }
    }
  });

  it('never rates a deal breaker the same way twice', () => {
    for (const user of candidates) {
      for (const value of user.questionnaire!.dealBreakers) {
        expect(user.questionnaire!.values).toContain(value);
      }
    }
  });

  it('respects the value cap and the prompt minimum', () => {
    for (const user of candidates) {
      expect(user.questionnaire!.values.length).toBeLessThanOrEqual(MAX_VALUES);
      expect(user.questionnaire!.values.length).toBeGreaterThan(0);
      expect(user.questionnaire!.prompts.length).toBeGreaterThanOrEqual(MIN_PROMPTS);
    }
  });

  it('never answers the same prompt tag twice', () => {
    // Two answers to one tag would score as one prompt but read as two
    // different opinions on the other person's card.
    for (const user of candidates) {
      const tags = user.questionnaire!.prompts.map((answer) => answer.tag);
      expect(new Set(tags).size).toBe(tags.length);
    }
  });

  it('varies answers across candidates rather than seeding everyone the same', () => {
    const signatures = new Set(
      candidates.map((user) => [...user.questionnaire!.values].sort().join('|'))
    );
    expect(signatures.size).toBeGreaterThan(1);
  });

  it('is deterministic for a given seed', () => {
    const first = generateMockUsers(5);
    const second = generateMockUsers(5);
    expect(second.map((user) => user.questionnaire)).toEqual(
      first.map((user) => user.questionnaire)
    );
  });
});

describe('seeded locations', () => {
  const candidates = generateMockUsers(20);
  const demo = generateDemoUser() as User;
  const distances = candidates.map((user) => distanceKm(demo.location, user.location));

  it('gives every candidate usable coordinates', () => {
    // Before this, coordinates were drawn uniformly from the globe, so a
    // distance filter had nothing it could keep and every deck came back empty.
    const unusable = candidates.filter((user) => !hasCoordinates(user.location));
    expect(unusable.map((user) => user.id)).toEqual([]);
  });

  it('keeps a city label consistent with the coordinates attached to it', () => {
    for (const user of candidates) {
      const centroid = findCityCentroid(user.location.city, user.location.country);
      expect(centroid).not.toBeNull();
      expect(distanceKm(centroid!, user.location)).toBeLessThan(400);
    }
  });

  it("fills the demo account's nearby radius", () => {
    // The demo account is set to 50 km. If this ever drops to zero the feed is
    // empty on first launch, which reads as a broken matcher rather than as an
    // empty seed.
    const withinRadius = distances.filter((km) => km <= demo.preferences.maxDistance).length;
    expect(withinRadius).toBeGreaterThanOrEqual(6);
  });

  it('leaves people out of that radius, so the limit is doing something', () => {
    // A radius that excludes nobody is not a filter, and the global toggle would
    // have nothing to demonstrate.
    const beyondRadius = distances.filter((km) => km > demo.preferences.maxDistance).length;
    expect(beyondRadius).toBeGreaterThanOrEqual(4);
  });

  it('widens the deck when the demo account switches to global', () => {
    const nearby = distances.filter((km) => km <= demo.preferences.maxDistance).length;
    expect(distances.length).toBeGreaterThan(nearby);
  });

  it("places most candidates in the demo account's own city", () => {
    const sameCity = candidates.filter((user) => user.location.city === demo.location.city);
    expect(sameCity.length).toBeGreaterThanOrEqual(6);
  });
});

describe('demo account', () => {
  it('has a complete, valid questionnaire', () => {
    const demo = generateDemoUser();
    expect(questionnaireSchema.safeParse(demo.questionnaire).success).toBe(true);
  });

  it('is not random, so the demo always tells the same story', () => {
    expect(generateDemoUser().questionnaire).toEqual(generateDemoUser().questionnaire);
  });

  it('starts on a nearby radius, so the global toggle has something to reveal', () => {
    const demo = generateDemoUser();
    expect(demo.preferences.distanceMode).toBe('nearby');
    expect(demo.preferences.maxDistance).toBeGreaterThan(0);
  });
});

describe('seeded preferences', () => {
  it('leaves candidates permissive, so the viewer is the constrained side', () => {
    // Matching is mutual. If the seed handed candidates a 50 km radius and a
    // narrow age range, their limits would bind before the viewer's and the
    // demo would show nothing about the viewer's own settings.
    for (const user of generateMockUsers(20)) {
      expect(user.preferences.distanceMode).toBe('global');
      expect(user.preferences.ageRange.min).toBeLessThanOrEqual(25);
      expect(user.preferences.ageRange.max).toBeGreaterThanOrEqual(40);
    }
  });

  it('never seeds a radius the distance filter would have to fight', () => {
    for (const user of generateMockUsers(20)) {
      expect(user.preferences.maxDistance).toBeGreaterThan(0);
      expect(user.preferences.maxDistance).toBeLessThanOrEqual(500);
    }
  });
});
