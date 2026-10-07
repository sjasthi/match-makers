import type { Location } from '@match-makers/shared';

import {
  EARTH_RADIUS_KM,
  destinationPoint,
  distanceKm,
  formatDistance,
  hasCoordinates,
} from './distance';

function at(latitude: number, longitude: number, city = 'Somewhere'): Location {
  return { latitude, longitude, city, country: 'Nowhere' };
}

const AUSTIN = at(30.2672, -97.7431, 'Austin');
const DALLAS = at(32.7767, -96.797, 'Dallas');
const MUNICH = at(48.1351, 11.582, 'Munich');

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(AUSTIN, AUSTIN)).toBe(0);
  });

  it('measures a known city pair to within a few kilometres', () => {
    // Austin to Dallas is about 293 km straight line. Asserting a real figure
    // rather than only round-trip properties, because a formula that is
    // self-consistent and wrong still passes those. The road distance of ~315 km
    // is not the number to assert here: this is centroid to centroid.
    expect(distanceKm(AUSTIN, DALLAS)).toBeGreaterThan(285);
    expect(distanceKm(AUSTIN, DALLAS)).toBeLessThan(300);
  });

  it('is symmetric', () => {
    expect(distanceKm(AUSTIN, MUNICH)).toBeCloseTo(distanceKm(MUNICH, AUSTIN), 9);
  });

  it('resolves near distances accurately instead of collapsing them to zero', () => {
    // The failure mode that put the law of cosines off the table: two points a
    // few hundred metres apart are the case a small distance limit spends all
    // its time in, so they have to survive. Coordinates are rounded to six
    // decimal places, so agreement is to about a metre rather than exact.
    const nextDoor = destinationPoint(AUSTIN, 90, 0.4);
    expect(Math.abs(distanceKm(AUSTIN, nextDoor) - 0.4)).toBeLessThan(0.001);
  });

  it('is half the circumference for antipodal points', () => {
    const half = distanceKm(at(0, 0), at(0, 180));
    expect(half).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 6);
  });

  it('crosses the antimeridian by the short way round', () => {
    // 179E and 179W are two degrees apart, not 358. Getting this wrong makes
    // two people on opposite sides of the date line look impossibly distant.
    const distance = distanceKm(at(0, 179), at(0, -179));
    expect(distance).toBeLessThan(250);
  });

  it('does not return NaN for numerically identical points', () => {
    // Math.asin of a hair over 1 is NaN, and a NaN distance fails every
    // comparison silently rather than loudly.
    const point = at(30.2672, -97.7431);
    expect(Number.isNaN(distanceKm(point, { ...point }))).toBe(false);
  });
});

describe('hasCoordinates', () => {
  it('accepts a real coordinate pair', () => {
    expect(hasCoordinates(AUSTIN)).toBe(true);
  });

  it('rejects the zero placeholder', () => {
    // Every new account and every hand-typed city starts here, and 0,0 is a real
    // point in the Gulf of Guinea, so it has to be treated as "unknown" rather
    // than as a location 10,000 km from everyone.
    expect(hasCoordinates(at(0, 0))).toBe(false);
  });

  it('accepts a coordinate on the equator or the prime meridian', () => {
    // Only an exact zero pair is the placeholder. Rejecting a real equator or
    // Greenwich location would silently drop those profiles.
    expect(hasCoordinates(at(0, 12.5))).toBe(true);
    expect(hasCoordinates(at(-33.9, 0))).toBe(true);
  });

  it('rejects non-finite coordinates', () => {
    expect(hasCoordinates(at(Number.NaN, 10))).toBe(false);
    expect(hasCoordinates(at(10, Number.POSITIVE_INFINITY))).toBe(false);
  });
});

describe('formatDistance', () => {
  it.each([
    [0, 'Under 1 km'],
    [0.4, 'Under 1 km'],
    [1, '1 km'],
    [12.4, '12 km'],
    [1249, '1249 km'],
  ])('renders %s as %s', (input, expected) => {
    expect(formatDistance(input)).toBe(expected);
  });

  it('renders nothing for a value it cannot render', () => {
    expect(formatDistance(Number.NaN)).toBe('');
    expect(formatDistance(-1)).toBe('');
  });
});

describe('destinationPoint', () => {
  it('lands exactly the requested distance from the origin', () => {
    // To within a metre, which is what rounding the coordinates to six decimal
    // places costs. Exact equality would be asserting on floating point noise.
    for (const km of [5, 40, 250, 900]) {
      const travelled = distanceKm(AUSTIN, destinationPoint(AUSTIN, 37, km));
      expect(Math.abs(travelled - km)).toBeLessThan(0.001);
    }
  });

  it('respects the bearing, so north really is north', () => {
    const north = destinationPoint(AUSTIN, 0, 100);
    const south = destinationPoint(AUSTIN, 180, 100);
    expect(north.latitude).toBeGreaterThan(AUSTIN.latitude);
    expect(south.latitude).toBeLessThan(AUSTIN.latitude);
  });

  it('keeps a point west of the antimeridian inside the valid range', () => {
    // Longitude has to wrap, and NaN or an out-of-range value here is what the
    // eligibility rules would then treat as a missing coordinate.
    const wrapped = destinationPoint(at(0, 179.5), 90, 200);
    expect(Number.isFinite(wrapped.longitude)).toBe(true);
    expect(wrapped.longitude).toBeGreaterThanOrEqual(-180);
    expect(wrapped.longitude).toBeLessThanOrEqual(180);
  });

  it('leaves the city label alone so a jittered seed still reads as its city', () => {
    expect(destinationPoint(AUSTIN, 90, 25).city).toBe('Austin');
  });
});
