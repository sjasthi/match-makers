import { PixelRatio } from 'react-native';
import { neededWidth, pickTileVariant, pickVariant } from './images';

/**
 * Picking a rendition is the `srcset` rule, done by hand.
 *
 * The rule under test is the one from the web: **choose the smallest rendition
 * that is not smaller than the display needs**, where "needs" is the display
 * width in CSS pixels multiplied by the device pixel ratio. Never upscale, and
 * never download more than will be shown.
 *
 * The numbers below assume a device pixel ratio of 2, which is what jest-expo
 * reports and what both a laptop and a phone give. The ratio is read from
 * `PixelRatio` rather than hardcoded into the arithmetic, so these tests would
 * still hold if that changed.
 */
const DPR = PixelRatio.get();

const ladder = [
  { width: 2560, uri: 'data:image/jpeg;base64,RUNG_2560' },
  { width: 1280, uri: 'data:image/jpeg;base64,RUNG_1280' },
  { width: 640, uri: 'data:image/jpeg;base64,RUNG_640' },
];

const post = {
  imageUri: 'data:image/jpeg;base64,FULL_2720',
  variants: ladder,
};

describe('neededWidth', () => {
  it('multiplies the CSS width by the device pixel ratio', () => {
    // 500 CSS pixels on a 2x screen is 1000 device pixels.
    expect(neededWidth(500)).toBe(500 * DPR);
    expect(DPR).toBe(2);
  });
});

describe('pickVariant', () => {
  it('picks the smallest rendition that covers the display', () => {
    // 300 CSS px at 2x needs 600 device px: the 640 rung, not the 1280 one.
    expect(pickVariant(post, 300)).toBe('data:image/jpeg;base64,RUNG_640');
  });

  it('picks a larger rung when the display is larger', () => {
    // 700 CSS px at 2x needs 1400 device px: the 1280 rung is too small, the
    // 2560 one is the smallest that fits.
    expect(pickVariant(post, 700)).toBe('data:image/jpeg;base64,RUNG_2560');
  });

  it('picks exactly the rung that matches', () => {
    // 640 CSS px at 2x needs 1280 device px.
    expect(pickVariant(post, 640)).toBe('data:image/jpeg;base64,RUNG_1280');
  });

  it('falls back to the full image when nothing is big enough', () => {
    // 2000 CSS px at 2x needs 4000 device px. No rung covers that, and the
    // full image is the largest thing there is -- it is the top of the ladder.
    //
    // Falling back to the widest *rung* instead would be worse: 2560 is
    // smaller than the full 2720, so it would stretch further.
    expect(pickVariant(post, 2000)).toBe('data:image/jpeg;base64,FULL_2720');
  });

  it('uses the full image when there is no ladder at all', () => {
    // A post imported before the ladder existed. The full image is all there is,
    // and it is the right answer.
    const old = { imageUri: 'data:image/jpeg;base64,FULL' };
    expect(pickVariant(old, 300)).toBe('data:image/jpeg;base64,FULL');
  });

  it('returns null when there is no image at all', () => {
    expect(pickVariant({ imageUri: '' }, 300)).toBeNull();
  });
});

describe('pickTileVariant', () => {
  it('uses the thumbnail for a tile, which is what it exists for', () => {
    // A 342px tile at 2x needs 684 device px. The 640 thumbnail is a hair
    // under that, and the 1280 rung is the smallest that covers it.
    expect(pickTileVariant({ ...post, thumbUri: 'data:image/jpeg;base64,THUMB' }, 342)).toBe(
      'data:image/jpeg;base64,RUNG_1280'
    );
  });

  it('uses the thumbnail when it is big enough', () => {
    // 200px tile at 2x needs 400 device px, and the 640 thumb covers it.
    expect(pickTileVariant({ ...post, thumbUri: 'data:image/jpeg;base64,THUMB' }, 200)).toBe(
      'data:image/jpeg;base64,THUMB'
    );
  });

  it('falls back to the ladder when there is no thumbnail', () => {
    // An old post with no thumb: the grid must not download the full image for a
    // 200px tile.
    expect(pickTileVariant(post, 200)).toBe('data:image/jpeg;base64,RUNG_640');
  });
});
