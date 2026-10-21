import { Dimensions, PixelRatio } from 'react-native';
import type { Post } from '@match-makers/shared';

/**
 * Choosing which rendition of a photo to show.
 *
 * This is the `srcset`/`sizes` pattern from the web, done by hand, because
 * React Native's `Image` has no `srcset` attribute and therefore no way to ask
 * the platform to pick.
 *
 * The web version works like this: the browser is told the set of renditions
 * and how big the image will be displayed, and it chooses -- using the viewport
 * width multiplied by the device pixel ratio -- the smallest rendition that is
 * still at least as large as the display needs. It never upscales, and it never
 * downloads more than it is going to show.
 *
 * The rule that matters is the "at least as large" part. A photo shown at 2500
 * CSS pixels on a 2x screen is drawn with 5000 device pixels, so a 2720px
 * rendition has to be stretched to fill them and comes out soft. Picking the
 * 640px thumbnail for that same case is worse: it is 8x too small.
 *
 * So the same rule, applied here: **the smallest rendition that is not smaller
 * than the display needs**. When there is no such rendition, the largest one
 * wins -- it will be stretched, but stretching the best available is the only
 * option, and it is what a browser would do too.
 */

/**
 * The pixel width a photo needs to be sharp at.
 *
 * `Dimensions.get('window').width` is in CSS pixels -- the same unit the layout
 * is measured in -- and `PixelRatio.get()` is how many device pixels there are
 * per one of them. Multiplying gives the number of device pixels the image will
 * actually occupy, which is what has to be covered.
 */
export function neededWidth(cssWidth: number): number {
  return Math.ceil(cssWidth * PixelRatio.get());
}

/**
 * The width of the whole window, in CSS pixels.
 *
 * Read per call rather than cached at module load: a browser window can be
 * resized, and a cached width would leave the app choosing renditions for a
 * screen it is no longer on.
 */
export function windowWidth(): number {
  return Dimensions.get('window').width;
}

/**
 * The rendition to display for a photo at a given display width.
 *
 * Returns the URI, or null when there is nothing to show.
 *
 * `variants` is expected widest-first, which is how the API returns it. The
 * search is linear because a ladder is three or four entries; a sort here would
 * be a sort on every tile of every grid.
 */
export function pickVariant(
  post: Pick<Post, 'imageUri' | 'variants'>,
  cssWidth: number
): string | null {
  if (!post.imageUri) return null;

  const needed = neededWidth(cssWidth);
  const variants = post.variants ?? [];

  if (variants.length === 0) {
    // No ladder -- an older post, or one imported before this existed. The
    // largest rendition is all there is, and it is the right answer.
    return post.imageUri;
  }

  // The smallest rendition that is not smaller than the display needs.
  //
  // Note "smallest that is big enough", not "first that is big enough": the
  // ladder arrives widest-first, so taking the first match would hand back the
  // largest one every time and the ladder would be pointless.
  //
  // The comparison is written as "keep the narrowest qualifying one" rather
  // than relying on the order, so a ladder that arrives in any order still
  // picks correctly. It is three entries; the loop is free.
  let best: { width: number; uri: string } | undefined;
  for (const variant of variants) {
    if (variant.width < needed) continue;
    if (!best || variant.width < best.width) best = variant;
  }

  // Nothing is big enough. `imageUri` is the largest rendition by construction
  // -- it is the top of the ladder, and the rungs live beside it -- so it is the
  // best thing available, even though it will be stretched. Falling back to
  // `variants[0]` would be worse: that is the widest *rung*, which is smaller
  // than the full image, so it would stretch further.
  return best?.uri ?? post.imageUri;
}

/**
 * The rendition to display in a grid tile.
 *
 * A tile is small -- a couple of hundred CSS pixels -- so this almost always
 * lands on the smallest rung, which is the point of having one: the grid should
 * not download a 2720px photo to draw it into a 342px box.
 */
export function pickTileVariant(
  post: Pick<Post, 'imageUri' | 'thumbUri' | 'variants'>,
  tileWidth: number
): string | null {
  const needed = neededWidth(tileWidth);

  // The thumbnail is the smallest rung by construction, and it is exactly the
  // size a tile needs. Checking it first avoids walking the ladder for the
  // common case.
  if (post.thumbUri && needed <= 640) return post.thumbUri;

  return pickVariant(post, tileWidth);
}
