import type { Post } from '@match-makers/shared';

import { hashString } from './hash';

/**
 * Laying a masonry grid out in React Native.
 *
 * `FlatList` with `numColumns` gives equal-height rows, which is a grid and not
 * a masonry. Two `FlatList`s side by side is a masonry and two independent
 * scrolls. The way out is to make each *item* of a single vertical `FlatList` a
 * row of tiles, rendered with `alignItems: 'flex-start'` so a short tile does not
 * stretch to match a tall one next to it.
 *
 * That buys one scroll container, one set of recycling logic, and a
 * virtualization granularity of one row rather than one tile. The rows have to
 * be computed in advance rather than measured, which is what `toMasonryRows`
 * does: posts are dealt into the shortest column, weighted by how tall they will
 * render, so the columns end up roughly level instead of one long and one stub.
 */

/** Narrowest ratio in the range. Slightly portrait, so a grid reads as content. */
const MIN_RATIO = 0.9;
/** Widest. Past this the tiles stop looking like a masonry of photos. */
const MAX_RATIO = 1.6;
/** Inclusive span, so the modulus below spreads over the whole range. */
const RATIO_SPAN = Math.round((MAX_RATIO - MIN_RATIO) * 100);

/**
 * How tall this post's tile is relative to its width, 0.9 to 1.6.
 *
 * Derived from the post id rather than measured from the image. Measuring needs
 * `Image.getSize`, which resolves after first paint, so the grid would visibly
 * re-flow as photos loaded — and the generated tag tiles have no intrinsic ratio
 * to measure at all. Hashing is stable across renders and platforms, correct on
 * the very first frame, and needs nothing loaded.
 *
 * It also means a tile keeps its height when a filter brings it back into view,
 * because the height follows the post and not its position in the list. The grid
 * does not reshuffle under a filter tap.
 */
export function tileAspectRatio(post: Post): number {
  return MIN_RATIO + (hashString(post.id) % RATIO_SPAN) / 100;
}

/** How many columns fit. Matches the usual breakpoints rather than being fixed. */
export function columnCountFor(width: number): number {
  if (width >= 768) return 4;
  if (width >= 480) return 3;
  return 2;
}

/**
 * Deals posts into columns by height, then interleaves them back out into the
 * order a `FlatList` with `numColumns` should render.
 *
 * Two steps, and both are needed:
 *
 * 1. **Deal by height.** Each post goes to whichever column is currently
 *    shortest, weighted by how tall it will render. Dealing in order would put
 *    runs of tall posts side by side and leave a visible notch.
 * 2. **Interleave.** `numColumns` fills visual rows left to right, so a column of
 *    five tiles has to be handed over spread across five rows. Returning the
 *    columns themselves would be wrong: the list would put column one beside
 *    column two in a single row.
 *
 * The result is a flat array where every window of `columns` items is one
 * visual row, and the rows have unequal tile heights because `alignItems:
 * flex-start` stops a short tile stretching to match a tall one beside it.
 */
export function toMasonryOrder<T extends { id: string }>(
  posts: T[],
  columns: number,
  aspectFor: (post: T) => number
): T[] {
  const count = Math.max(1, Math.floor(columns));
  if (posts.length === 0) return [];

  // Cumulative rendered height per column, in ratio units.
  const heights = new Array<number>(count).fill(0);
  const buckets: T[][] = Array.from({ length: count }, () => []);

  for (const post of posts) {
    let shortest = 0;
    for (let column = 1; column < count; column += 1) {
      if (heights[column]! < heights[shortest]!) shortest = column;
    }

    buckets[shortest]!.push(post);
    // Widths are equal, so a post's rendered height is proportional to its ratio
    // and the common tile width cancels out of the comparison.
    heights[shortest] = heights[shortest]! + aspectFor(post);
  }

  const longest = buckets.reduce((max, bucket) => Math.max(max, bucket.length), 0);
  const ordered: T[] = [];

  for (let row = 0; row < longest; row += 1) {
    for (const bucket of buckets) {
      const post = bucket[row];
      // The last visual row can be short. It stays short rather than being
      // padded with an invisible tile, because a gap at the end of a masonry is
      // normal and an invisible one would still occupy a slot.
      if (post) ordered.push(post);
    }
  }

  return ordered;
}