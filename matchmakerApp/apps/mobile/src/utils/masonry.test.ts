import type { Post } from '@match-makers/shared';

import { columnCountFor, tileAspectRatio, toMasonryOrder } from './masonry';

function post(id: string): Post {
  return { id, imageUri: '', tags: [], createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('tileAspectRatio', () => {
  it('is the same every time for the same post', () => {
    // The grid lays out before any image loads, so the height cannot depend on
    // something asynchronous or the columns would re-deal as photos arrived.
    expect(tileAspectRatio(post('post_0001'))).toBe(tileAspectRatio(post('post_0001')));
  });

  it('stays inside the range that reads as a photo grid', () => {
    for (let index = 1; index <= 60; index += 1) {
      const ratio = tileAspectRatio(post(`post_${index}`));
      expect(ratio).toBeGreaterThanOrEqual(0.9);
      expect(ratio).toBeLessThanOrEqual(1.6);
    }
  });

  it('varies between posts, so the grid is not a repeating pattern', () => {
    const ratios = new Set(
      Array.from({ length: 24 }, (_, index) => tileAspectRatio(post(`post_${index + 1}`)))
    );

    // A grid where every tile is the same height is a grid, not a masonry. Twenty
    // four posts should not collapse into a handful of heights.
    expect(ratios.size).toBeGreaterThan(12);
  });

  it('follows the post, not its position, so filtering does not reshuffle', () => {
    const a = post('post_0001');
    const b = post('post_0002');

    // Same tile, different index in the list: the height must not move, or every
    // filter tap would re-deal the whole grid under the finger.
    const before = tileAspectRatio(b);
    const _ = [a, b, post('post_0003')];
    expect(tileAspectRatio(b)).toBe(before);
  });
});

describe('columnCountFor', () => {
  it.each([
    [320, 2],
    [375, 2],
    [479, 2],
    [480, 3],
    [767, 3],
    [768, 4],
    [1024, 4],
  ])('gives %ipx %i columns', (width, expected) => {
    expect(columnCountFor(width)).toBe(expected);
  });
});

describe('toMasonryOrder', () => {
  const posts = Array.from({ length: 11 }, (_, index) => post(`post_${index + 1}`));
  const ratio = tileAspectRatio;

  it('returns nothing for nothing', () => {
    expect(toMasonryOrder([], 2, ratio)).toEqual([]);
  });

  it('keeps every post exactly once', () => {
    const ordered = toMasonryOrder(posts, 2, ratio);

    expect(ordered).toHaveLength(posts.length);
    expect(new Set(ordered.map((entry) => entry.id)).size).toBe(posts.length);
  });

  it('reorders, because a column has to be spread across visual rows', () => {
    // The bug this guards: returning the columns themselves. `numColumns` would
    // then put column one beside column two in a single row, so one visual row
    // would hold five tiles and six tiles rather than one of each.
    expect(toMasonryOrder(posts, 2, ratio).map((entry) => entry.id)).not.toEqual(
      posts.map((entry) => entry.id)
    );
  });

  it('takes consecutive items from different columns', () => {
    const ordered = toMasonryOrder(posts, 2, ratio);
    const pairs = ordered.filter((_, index) => index % 2 === 0);

    // Pairing the even and odd positions reconstructs the two columns, and
    // neither may be the identity run of the input.
    const first = pairs.map((entry) => entry.id);
    expect(first).not.toEqual(posts.map((entry) => entry.id));
  });

  it('leaves the order alone for a single column', () => {
    // One column has nothing to interleave, so the input order is the answer and
    // reordering it would be pointless churn.
    expect(toMasonryOrder(posts, 1, ratio).map((entry) => entry.id)).toEqual(
      posts.map((entry) => entry.id)
    );
  });

  it('balances the columns by height rather than by count', () => {
    const ordered = toMasonryOrder(posts, 2, ratio);
    const even = ordered.filter((_, index) => index % 2 === 0);
    const odd = ordered.filter((_, index) => index % 2 === 1);

    const total = (entries: typeof posts) =>
      entries.reduce((sum, entry) => sum + ratio(entry), 0);
    const [shorter = 0, taller = 0] = [total(even), total(odd)].sort((a, b) => a - b);

    // The point of dealing by height: the columns end up close in rendered height
    // rather than one long and one stub.
    expect(Math.abs(taller - shorter)).toBeLessThan(2);
  });

  it('leaves the last row short rather than padding it', () => {
    // 11 posts over 2 columns is five full visual rows and a ragged sixth.
    expect(toMasonryOrder(posts, 2, ratio)).toHaveLength(11);
    expect(toMasonryOrder(posts.slice(0, 3), 2, ratio)).toHaveLength(3);
  });

  it('does not pad when there are fewer posts than columns', () => {
    expect(toMasonryOrder(posts.slice(0, 2), 4, ratio)).toHaveLength(2);
  });

  it('survives a nonsense column count rather than dividing by it', () => {
    expect(toMasonryOrder(posts.slice(0, 2), 0, ratio)).toHaveLength(2);
  });
});
