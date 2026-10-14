import { describeTags, normaliseTag, tagDisplay } from '@match-makers/shared';

import { hashString } from '@/utils/hash';
import { COLORS } from '@/constants';

/**
 * How a free-text tag is drawn.
 *
 * Tags are words somebody typed, so there is no lookup table for any of this.
 * Colour comes from hashing the tag into the existing swatches; glyphs are the
 * one thing that cannot be hashed, because there is no meaningful way to derive
 * an emoji from a string. That leaves a small asymmetry worth knowing about: the
 * seed vocabulary has glyphs and anything typed does not, so a seeded `pets`
 * photo shows a paw and a typed `dog` photo shows a camera on the tile.
 *
 * It is a placeholder either way. Neither is a picture of the actual photo, and
 * the difference is not worth a lookup table keyed to a vocabulary that no longer
 * exists as a closed set.
 */

/**
 * The palette, hashed into by tag.
 *
 * Kept to the ten colours the prototype already used so a typed tag and a seeded
 * tag are stylistically identical and no new colours enter the design. Order is
 * irrelevant to correctness; the hash is what decides.
 */
const SWATCHES = [
  '#F2A65A',
  '#E8734A',
  '#4EA872',
  '#E05780',
  '#3FA9C9',
  '#8B6FD1',
  '#5FC2A0',
  '#D4699E',
  '#C9974A',
  '#6A7BD1',
] as const;

/** Glyphs for the seeded vocabulary only. See the note at the top of the file. */
const GLYPHS: Record<string, string> = {
  pets: '🐕',
  animal: '🦊',
  outdoor: '🏔️',
  food: '🍝',
  travel: '🧭',
  music: '🎧',
  fitness: '🏃',
  art: '🎨',
  home: '🕯️',
  nightlife: '🌙',
};

/** Stands in for any tag with no glyph of its own. */
const FALLBACK_GLYPH = '📷';

/**
 * A stable colour for a tag.
 *
 * Hashed rather than assigned, because there is nothing to assign from. `hashed`
 * covers both directions: `dog` and `dog` always get the same swatch, and two
 * unrelated words usually get different ones.
 */
export function tagColor(tag: string): string {
  if (!tag) return COLORS.surfaceVariant;
  return SWATCHES[hashString(normaliseTag(tag)) % SWATCHES.length]!;
}

/** The tile colour for a post, taken from its primary tag. */
export function postColor(tags: string[]): string {
  return tagColor(tags[0] ?? '');
}

export function tagGlyph(tag: string): string {
  return GLYPHS[normaliseTag(tag)] ?? FALLBACK_GLYPH;
}

/** Capitalised for chips and headings: `hiking` becomes `Hiking`. */
export function tagLabel(tag: string): string {
  return tagDisplay(tag);
}

/**
 * Reads a tag list as a sentence, capped at three then "and N more".
 *
 * Re-exported from `apps/shared` rather than reimplemented, so the sentence
 * under a match percentage and the wording in a test can never drift apart.
 */
export { describeTags as tagList };

/**
 * Ranks suggestions for a tag being typed.
 *
 * Substring, not prefix: somebody typing `dog` should see `dog` and `hot dog`,
 * and somebody who has half-typed `ca` should not be shown `acoustic`. Matches
 * are ordered with prefix hits first, then by how often the tag is already used,
 * so the word somebody is most likely to mean is the first one under their
 * finger.
 *
 * Excluding the tags already on the photo is deliberate. Suggesting a tag that is
 * already there invites a duplicate, and the input rejects duplicates anyway, so
 * showing it would be offering something that cannot be used.
 */
export function rankSuggestions(
  typed: string,
  candidates: ReadonlyArray<{ tag: string; count: number }>,
  exclude: readonly string[] = [],
  limit = 6
): string[] {
  const query = normaliseTag(typed);
  const taken = new Set(exclude.map(normaliseTag));
  if (!query) {
    // Nothing typed yet: the most used tags are the most useful suggestion, and
    // they are what an empty input should offer.
    return candidates
      .filter((entry) => !taken.has(normaliseTag(entry.tag)))
      .slice()
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, limit)
      .map((entry) => normaliseTag(entry.tag));
  }

  const matches = candidates.filter((entry) => {
    const tag = normaliseTag(entry.tag);
    return tag.includes(query) && !taken.has(tag);
  });

  return matches
    .slice()
    .sort((a, b) => {
      const aPrefix = normaliseTag(a.tag).startsWith(query);
      const bPrefix = normaliseTag(b.tag).startsWith(query);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      return b.count - a.count || a.tag.localeCompare(b.tag);
    })
    .slice(0, limit)
    .map((entry) => normaliseTag(entry.tag));
}