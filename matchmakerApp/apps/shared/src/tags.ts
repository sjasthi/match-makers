/**
 * How a typed tag becomes the thing that gets stored and compared.
 *
 * Tags are free text now. Somebody types a word, presses enter, and that word is
 * a tag. The cost of that is that there is nothing left to guarantee two people
 * who meant the same thing typed the same thing, so every tag is folded to one
 * canonical spelling before it is written.
 *
 * Folding at write time rather than at match time is deliberate. One spelling in
 * storage means the reactions index is self-consistent by construction, there is
 * no second normalisation pass that could disagree with the first, and what the
 * admin sees on the chip is exactly what was stored. There is no "why did it
 * change my word" moment, because the chip shows the canonical form the moment
 * it is committed.
 */

/** Long enough for "amphibians" and "photography", short enough for a phone chip. */
export const TAG_MAX_LENGTH = 24;

/**
 * Folds a plural "s" so `dogs` and `dog` are one tag.
 *
 * A naive trailing-"s" strip would mangle perfectly good words: `fitness`
 * becomes `fitnes`, `glass` becomes `glas`, `bus` becomes `bu`. Those would
 * still match each other consistently, so nothing would visibly break, but the
 * chip would show a misspelling on the one screen an admin is using to check
 * their work. So the fold is guarded:
 *
 * - longer than 3 characters, so `gas` and `bus` survive
 * - not ending in `ss`, so `fitness`, `glass`, `dress` survive
 * - not ending in `us`, so `bus`, `focus`, `cactus` survive
 * - not ending in `is`, so `iris` and `analysis` survive
 *
 * This is a heuristic, not a stemmer, and it has a known false positive: `news`
 * folds to `new`, so somebody who types `news` and somebody who types `new` will
 * connect when they arguably should not. That is a rare pairing for a photo tag
 * and the alternative is either a dictionary dependency or an admin alias table,
 * so it is accepted rather than hidden. `dogs` and `dog` is the common case and
 * this gets it right.
 */
function foldPlural(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;
  if (!word.endsWith('s')) return word;
  return word.slice(0, -1);
}

/**
 * The canonical form of a tag: `Dogs`, `  DOGS `, and `dog` all become `dog`.
 *
 * Never returns an empty string for non-empty input, and returns `''` only for
 * input that was empty or whitespace to begin with, which callers treat as "no
 * tag" rather than as a tag called nothing.
 */
export function normaliseTag(input: string): string {
  return foldPlural(input.trim().replace(/\s+/g, ' ').toLowerCase());
}

/**
 * Renders a canonical tag as a heading: `hiking` becomes `Hiking`.
 *
 * Only the first character is touched. A tag is somebody's own word, so there is
 * no title case that is reliably right, and `iPhone` typed by a human should
 * stay `iPhone`.
 */
export function tagDisplay(tag: string): string {
  if (!tag) return '';
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

/** How many tags a match-reason sentence will spell out before it says "and N more". */
export const TAG_SENTENCE_LIMIT = 3;

/**
 * Reads a tag list as a sentence: `dog`, `dog and cat`, `dog, cat and bird`,
 * `dog, cat, bird and 5 more`.
 *
 * Capped because the sentence goes under a match percentage, and a sentence with
 * eight tags in it is not a sentence. The cap belongs here rather than at the
 * call site because every caller is showing the same thing and the exact cut-off
 * is a wording decision, not a per-screen one.
 */
export function describeTags(tags: string[]): string {
  if (tags.length === 0) return '';
  if (tags.length === 1) return tags[0]!;

  const shown = tags.slice(0, TAG_SENTENCE_LIMIT);
  const rest = tags.length - shown.length;

  if (rest > 0) {
    // Comma list, then a count. The usual "a, b and c" join is wrong here
    // because "and 5 more" is already the conjunction, and joining both gives
    // "a, b and c and 5 more".
    return `${shown.join(', ')}, ${rest} more`;
  }

  const last = shown[shown.length - 1]!;
  return shown.length === 1 ? last : `${shown.slice(0, -1).join(', ')} and ${last}`;
}