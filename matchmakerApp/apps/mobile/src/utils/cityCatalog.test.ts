import { CITY_CENTROIDS, findCityCentroid } from './cityCatalog';

describe('findCityCentroid', () => {
  it('resolves a city to a usable point', () => {
    const austin = findCityCentroid('Austin', 'United States');
    expect(austin?.latitude).toBeCloseTo(30.2672, 4);
    expect(austin?.longitude).toBeCloseTo(-97.7431, 4);
  });

  it('ignores capitalisation, padding and repeated spaces', () => {
    // All three are things a person types on a phone keyboard, and failing on
    // any of them silently sends them back to the GPS prompt.
    expect(findCityCentroid('  austin  ', 'united states')).not.toBeNull();
    expect(findCityCentroid('SAN ANTONIO', 'United States')?.city).toBe('San Antonio');
    expect(findCityCentroid('San   Antonio', 'United States')?.city).toBe('San Antonio');
  });

  it('resolves a city with no country given', () => {
    expect(findCityCentroid('Rotterdam')?.country).toBe('Netherlands');
  });

  it('normalises common country spellings', () => {
    // The country is typed by hand, so `USA` and `United States` have to land on
    // the same row or the lookup silently falls through.
    expect(findCityCentroid('Austin', 'USA')).toEqual(findCityCentroid('Austin', 'United States'));
    expect(findCityCentroid('London', 'UK')?.country).toBe('United Kingdom');
    expect(findCityCentroid('Dubai', 'UAE')?.country).toBe('United Arab Emirates');
  });

  it('tolerates a mistyped country rather than rejecting the city', () => {
    // Nobody has a good reason to spell `Portugal` exactly. Rejecting the whole
    // lookup over it would push them back to sharing their GPS position.
    expect(findCityCentroid('Lisbon', 'Portigal')?.country).toBe('Portugal');
  });

  it('returns null for a city it does not know', () => {
    // Null is the normal answer for most of the world, not an exception, so it
    // has to be a value callers can actually get and handle.
    expect(findCityCentroid('Nowheresville')).toBeNull();
    expect(findCityCentroid('')).toBeNull();
    expect(findCityCentroid('   ')).toBeNull();
  });

  it('never resolves to the zero placeholder', () => {
    // The whole table exists so that typed cities get coordinates, and 0,0 is
    // the exact value the eligibility rules treat as missing.
    const unusable = CITY_CENTROIDS.filter(
      (entry) => entry.latitude === 0 && entry.longitude === 0
    );
    expect(unusable).toHaveLength(0);
  });

  it('gives every entry coordinates inside the valid range of the globe', () => {
    for (const entry of CITY_CENTROIDS) {
      expect(entry.latitude).toBeGreaterThanOrEqual(-90);
      expect(entry.latitude).toBeLessThanOrEqual(90);
      expect(entry.longitude).toBeGreaterThanOrEqual(-180);
      expect(entry.longitude).toBeLessThanOrEqual(180);
      expect(entry.city.trim()).toBe(entry.city);
      expect(entry.country.trim()).toBe(entry.country);
    }
  });
});
