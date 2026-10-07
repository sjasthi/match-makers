import type { Location } from '@match-makers/shared';

/**
 * Mean Earth radius, in kilometres.
 *
 * 6371 is the IUGG mean of the WGS84 equatorial (6378.137) and polar (6356.752)
 * radii. The true figure varies by about 0.5% depending on where you are on
 * the planet, which at the scale a discovery radius works in is well under a
 * kilometre. Using the mean is stated plainly rather than hidden so a reader
 * can see the approximation is deliberate instead of mistaken for a constant
 * someone invented.
 */
export const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Haversine rather than the spherical law of cosines because that formula
 * loses precision at small angles, and "under 5 km" is precisely the range a
 * nearby filter spends most of its time in. Haversine keeps its accuracy there
 * because it differences the coordinates before taking the square root.
 *
 * Antipodal points, which is where any spherical model is least accurate,
 * are the one case where the mean radius does matter: the result will be off by
 * tens of kilometres. That is irrelevant for filtering, and the alternative is
 * an iterative solver that would be slower for no visible gain.
 */
export function distanceKm(from: Location, to: Location): number {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);

  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  // Half the chord length between the two points, squared.
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  // Clamped because floating point can push this a hair past 1 for two points
  // that are numerically a couple of nanometres apart, and Math.asin(1.0000001)
  // is NaN. A NaN distance would silently fail every comparison against it.
  const centralAngle = 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
  return EARTH_RADIUS_KM * centralAngle;
}

/**
 * Whether a location holds coordinates we can actually measure from.
 *
 * `0, 0` is a real point in the Gulf of Guinea and the placeholder every new
 * account and every hand-typed city starts out with, so the two are
 * indistinguishable by value alone. Treating it as a location would put a
 * profile off the coast of Africa about 10,000 km from anywhere, which would
 * then be excluded from every nearby filter for reasons nobody can see.
 *
 * So a coordinate pair of exactly zero, or any non-finite number, counts as
 * unknown. Near-null-but-not-zero values are kept: rounding a real location
 * to six decimal places never lands on exactly zero.
 */
export function hasCoordinates(location: Location): boolean {
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return latitude !== 0 || longitude !== 0;
}

/**
 * Distance for display: metres under a kilometre, whole kilometres above.
 *
 * A raw "0.37 km" on a card invites the reader to believe we know where
 * someone lives to within 370 metres, which is false of any coordinate a
 * person typed or a city centroid we looked up. "Under 1 km" is the honest
 * rendering of a number that is only ever good to a few kilometres.
 */
export function formatDistance(kilometres: number): string {
  if (!Number.isFinite(kilometres) || kilometres < 0) return '';
  if (kilometres < 1) return 'Under 1 km';
  return `${Math.round(kilometres)} km`;
}

/**
 * The point `kilometres` away from `origin` on a given compass bearing.
 *
 * The inverse of `distanceKm`, and the only honest way to build a location at
 * a known range. Adding degrees to a latitude instead would silently stretch or
 * squash the radius with latitude, so a point placed "50 km north" of Nairobi
 * and one placed "50 km north" of Oslo would not be the same distance apart.
 *
 * Used by the demo seed to put candidates at chosen ranges from the home city,
 * which is what makes the nearby/global split observable rather than asserted.
 */
export function destinationPoint(
  origin: Location,
  bearingDegrees: number,
  kilometres: number
): Location {
  const angularDistance = kilometres / EARTH_RADIUS_KM;
  const bearing = toRadians(bearingDegrees);
  const originLatitude = toRadians(origin.latitude);
  const originLongitude = toRadians(origin.longitude);

  const destinationLatitude = Math.asin(
    Math.sin(originLatitude) * Math.cos(angularDistance) +
      Math.cos(originLatitude) * Math.sin(angularDistance) * Math.cos(bearing)
  );

  const destinationLongitude =
    originLongitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(originLatitude),
      Math.cos(angularDistance) - Math.sin(originLatitude) * Math.sin(destinationLatitude)
    );

  return {
    ...origin,
    latitude: Number((destinationLatitude * (180 / Math.PI)).toFixed(6)),
    longitude: Number((((destinationLongitude * (180 / Math.PI) + 540) % 360) - 180).toFixed(6)),
  };
}
