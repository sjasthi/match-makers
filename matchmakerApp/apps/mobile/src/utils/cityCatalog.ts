import type { Location } from '@match-makers/shared';

/**
 * A city reduced to the one point that represents it.
 *
 * Coordinates are the city centre rather than anything more precise on purpose.
 * A centroid is a place a person might plausibly say they live, whereas a
 * precise point implies a precision nobody consented to. For a discovery radius
 * measured in kilometres the difference is immaterial.
 */
export interface CityCentroid extends Pick<
  Location,
  'city' | 'country' | 'latitude' | 'longitude'
> {}

/**
 * The lookup behind "type your city instead of sharing your location".
 *
 * Handing over GPS is a real cost, and a prototype that offers no alternative
 * is a prototype that can only be demoed by people who are willing to share
 * their exact position. So a typed city has to resolve to something
 * measurable, otherwise the profile silently has no coordinates and the
 * distance rules exclude it from every nearby deck.
 *
 * This table is a stand-in for geocoding. A real backend would resolve city
 * names against a gazetteer covering every town worth naming, and would return
 * a region centroid rather than a city centre. The table is small on purpose: it
 * holds the cities the demo seed uses plus majors a tester is likely to try, and
 * `findCityCentroid` returning null is the honest answer for anywhere else.
 */
export const CITY_CENTROIDS: readonly CityCentroid[] = [
  { city: 'Austin', country: 'United States', latitude: 30.2672, longitude: -97.7431 },
  { city: 'San Antonio', country: 'United States', latitude: 29.4241, longitude: -98.4936 },
  { city: 'Houston', country: 'United States', latitude: 29.7604, longitude: -95.3698 },
  { city: 'Dallas', country: 'United States', latitude: 32.7767, longitude: -96.797 },
  { city: 'Denver', country: 'United States', latitude: 39.7392, longitude: -104.9903 },
  { city: 'Chicago', country: 'United States', latitude: 41.8781, longitude: -87.6298 },
  { city: 'New York', country: 'United States', latitude: 40.7128, longitude: -74.006 },
  { city: 'Los Angeles', country: 'United States', latitude: 34.0522, longitude: -118.2437 },
  { city: 'San Francisco', country: 'United States', latitude: 37.7749, longitude: -122.4194 },
  { city: 'Mexico City', country: 'Mexico', latitude: 19.4326, longitude: -99.1332 },
  { city: 'Toronto', country: 'Canada', latitude: 43.6532, longitude: -79.3832 },
  { city: 'Montreal', country: 'Canada', latitude: 45.5019, longitude: -73.5674 },
  { city: 'Vancouver', country: 'Canada', latitude: 49.2827, longitude: -123.1207 },
  { city: 'London', country: 'United Kingdom', latitude: 51.5074, longitude: -0.1278 },
  { city: 'Manchester', country: 'United Kingdom', latitude: 53.4808, longitude: -2.2426 },
  { city: 'Dublin', country: 'Ireland', latitude: 53.3498, longitude: -6.2603 },
  { city: 'Lisbon', country: 'Portugal', latitude: 38.7223, longitude: -9.1393 },
  { city: 'Madrid', country: 'Spain', latitude: 40.4168, longitude: -3.7038 },
  { city: 'Barcelona', country: 'Spain', latitude: 41.3874, longitude: 2.1686 },
  { city: 'Paris', country: 'France', latitude: 48.8566, longitude: 2.3522 },
  { city: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 },
  { city: 'Amsterdam', country: 'Netherlands', latitude: 52.3676, longitude: 4.9041 },
  { city: 'Rotterdam', country: 'Netherlands', latitude: 51.9244, longitude: 4.4777 },
  { city: 'Nairobi', country: 'Kenya', latitude: -1.2921, longitude: 36.8219 },
  { city: 'Lagos', country: 'Nigeria', latitude: 6.5244, longitude: 3.3792 },
  { city: 'Cape Town', country: 'South Africa', latitude: -33.9249, longitude: 18.4241 },
  { city: 'Cairo', country: 'Egypt', latitude: 30.0444, longitude: 31.2357 },
  { city: 'Dubai', country: 'United Arab Emirates', latitude: 25.2048, longitude: 55.2708 },
  { city: 'Mumbai', country: 'India', latitude: 19.076, longitude: 72.8777 },
  { city: 'Singapore', country: 'Singapore', latitude: 1.3521, longitude: 103.8198 },
  { city: 'Tokyo', country: 'Japan', latitude: 35.6762, longitude: 139.6503 },
  { city: 'Seoul', country: 'South Korea', latitude: 37.5665, longitude: 126.978 },
  { city: 'Melbourne', country: 'Australia', latitude: -37.8136, longitude: 144.9631 },
  { city: 'Sydney', country: 'Australia', latitude: -33.8688, longitude: 151.2093 },
  { city: 'Perth', country: 'Australia', latitude: -31.9505, longitude: 115.8605 },
  { city: 'Auckland', country: 'New Zealand', latitude: -36.8485, longitude: 174.7633 },
  { city: 'Bogota', country: 'Colombia', latitude: 4.711, longitude: -74.0721 },
  { city: 'Sao Paulo', country: 'Brazil', latitude: -23.5505, longitude: -46.6333 },
  { city: 'Buenos Aires', country: 'Argentina', latitude: -34.6037, longitude: -58.3816 },
];

/**
 * Spellings people type for a country, mapped onto the name we store.
 *
 * Countries are free text, so the same place arrives as `USA`, `us` and `United
 * States`. Without this, the country half of the match silently fails for anyone
 * who types the common form, and a typed city falls back to GPS.
 */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  us: 'united states',
  usa: 'united states',
  uae: 'united arabic emirates',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  britain: 'united kingdom',
  england: 'united kingdom',
  scotland: 'united kingdom',
  holland: 'netherlands',
  'the netherlands': 'netherlands',
  korea: 'south korea',
};

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normaliseCountry(value: string): string {
  const key = normalise(value);
  return COUNTRY_ALIASES[key] ?? key;
}

/**
 * Resolves a typed city to a measurable point, or null if we do not know it.
 *
 * Matching is on the city name, case- and whitespace-insensitively, because
 * that is what people actually type. The country is only used to break a tie:
 * treating a mismatched country as a hard failure would reject `Lisbon,
 * Portugal` written as `Lisbon, Portigal`, over a field the person had no reason
 * to get exact. A null return means "we do not know this city", which callers
 * must treat as a real outcome rather than an edge case.
 */
export function findCityCentroid(city: string, country = ''): CityCentroid | null {
  const wanted = normalise(city);
  if (!wanted) return null;

  const matches = CITY_CENTROIDS.filter((entry) => normalise(entry.city) === wanted);
  if (matches.length === 0) return null;

  const wantedCountry = normaliseCountry(country);
  if (wantedCountry) {
    const exact = matches.find((entry) => normaliseCountry(entry.country) === wantedCountry);
    if (exact) return exact;
  }

  // Only one candidate city, or several the caller gave no country to narrow.
  return matches[0] ?? null;
}
