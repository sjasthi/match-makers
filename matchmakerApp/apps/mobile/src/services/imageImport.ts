import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { APP_CONFIG } from '@/constants';

/**
 * Turning a picked image into something that survives being written to storage.
 *
 * The admin is a curator importing photographs off a camera, so the source
 * images are 12-48 megapixel files several megabytes each. Storing those
 * verbatim does not work: on web the bytes are inlined as a data URI, where a
 * single unresized photo can exceed the whole quota, and on device it makes the
 * feed decode enormous bitmaps for tiles two hundred pixels wide.
 *
 * So every image goes through `expo-image-manipulator` before it is stored, twice
 * over: once for the full image and once for a grid-sized thumbnail. Both passes:
 *
 *  - Resizes to a chosen target width, preserving aspect ratio. This is the
 *    reason the picker is asked for `quality: 1`; the picker only re-encodes,
 *    it cannot change dimensions, and letting it compress first would mean
 *    decoding a file that had already been thrown away.
 *  - Re-encodes to JPEG at a fixed compression, which is what bounds the bytes.
 *    JPEG rather than PNG because these are photographs and a PNG of one is an
 *    order of magnitude larger. That does mean an uploaded image with an alpha
 *    channel loses it, which is the right trade for a photo feed.
 *
 * On web the resampler returns a data URI, which is exactly what has to be
 * stored there: a `blob:` URL from the picker dies with the document, and
 * AsyncStorage has nothing to reload it from. On device it returns a `file://`
 * path into the app's media cache, which is durable for as long as the install
 * lives. Both platforms therefore take the same code path and differ only in
 * what `uri` means, which is why there is no platform branch below.
 */

/**
 * Compression for everything written to the library.
 *
 * 0.9 rather than the 0.8 this used to be. The difference is visible at 100%
 * zoom on a large display, which is exactly where a photo is looked at properly
 * -- the grid tile is small enough that nobody can tell, and the full-screen
 * viewer is where the softness showed. It costs roughly 40% more bytes, and on
 * web those bytes are in the database, so it is a deliberate trade of storage
 * for sharpness.
 */
const COMPRESS = 0.9;

/**
 * Guard so one enormous image cannot fill the whole store and break the app.
 *
 * In *raw* bytes, not base64 characters. A data URI is base64, a known 4/3
 * expansion, so the raw size is what the budget is really about.
 */
const MAX_BYTES = 1_500_000;

/**
 * The widest image that will ever be stored.
 *
 * 4096, which is the width a full-screen photo needs on a large 2x display: a
 * 2048-point-wide window at 2x is 4096 device pixels, and anything narrower is
 * upscaled by the viewer and comes out soft.
 *
 * This is the cap that makes "keep as much of the original as fits" automatic
 * rather than a guess. A 12-megapixel source is wider than this and gets scaled
 * down to it; a 3-megapixel source is narrower and is kept whole.
 *
 * It was 2880, which covers a 1440-point window at 2x. That is a laptop, and a
 * 2560-point window on the same display was stretching whatever it was given.
 */
const MAX_STORED_WIDTH = 4096;

/**
 * Width of the grid-sized copy, written alongside every import.
 *
 * Not a preset, because the grid is not a choice the admin makes. A masonry tile
 * is about 160 points wide, so 640 covers it at 3x with nothing to spare.
 */
const THUMB_WIDTH = 640;

/**
 * The rendition ladder.
 *
 * The `srcset` of the web, as a set of widths. A browser picks from a `srcset`
 * by display size multiplied by device pixel ratio, and never upscales; React
 * Native has no `srcset` attribute, so the app does the same choosing itself
 * and needs the alternatives to exist.
 *
 * 640 for a grid tile, 1280 for a half-screen view, 2560 for a large one. The
 * full image is the top of the ladder and is not repeated here -- it is the
 * photo itself, and `imageUri` already points at it.
 *
 * web.dev's guidance is three to five renditions per image, which this is: the
 * full one plus these three.
 */
const VARIANT_WIDTHS = [2560, 1280, 640];

/**
 * Width a profile photo is stored at.
 *
 * A profile photo is shown as an avatar almost everywhere -- a list row, a
 * conversation header, a match card -- and full-screen in the deck card. 1200
 * covers the deck card at 3x on a phone, which is the largest it is ever
 * displayed.
 *
 * It used to be the *source* width, untouched, because the profile photo picker
 * never went through this resampler at all. A 12-megapixel photo therefore went
 * into a text column as a 9-megabyte base64 PNG. This is the fix.
 */
const PROFILE_PHOTO_WIDTH = 1200;

/**
 * Target widths an admin can import at.
 *
 * `auto` is the default and the point: it keeps as much of the original as
 * fits the byte budget, so the full-screen viewer is not upscaling a photo that
 * was shrunk to fit a screen nobody is using. The fixed sizes remain as
 * explicit caps for somebody who wants the storage back rather than the pixels.
 */
export const IMPORT_SIZES = [
  { id: 'auto', label: 'Auto', detail: 'As large as fits', width: MAX_STORED_WIDTH },
  { id: 'grid', label: 'Grid', detail: '640 px', width: 640 },
  { id: 'feed', label: 'Feed', detail: '1200 px', width: 1200 },
  { id: 'large', label: 'Large', detail: '2048 px', width: 2048 },
] as const;

export type ImportSizeId = (typeof IMPORT_SIZES)[number]['id'];

export const DEFAULT_IMPORT_SIZE: ImportSizeId = 'auto';

/**
 * The target width for an id.
 *
 * `auto` resolves to the widest we will store; the caller then narrows it to the
 * source width and to the byte budget.
 */
export function importSizeWidth(id: ImportSizeId): number {
  return IMPORT_SIZES.find((size) => size.id === id)?.width ?? MAX_STORED_WIDTH;
}

export interface PickedImage {
  /** A `file://` path on device, a data URI on web. Empty when unusable. */
  uri: string;
  /**
   * A grid-sized copy, or absent when the full image is already small enough that
   * a second file would be a larger file with nothing removed.
   */
  thumbUri?: string;
  /** Set when the image was rejected, so the caller can explain which and why. */
  problem?: string;
  /** Stored width of the full image, so the viewer can size its card. */
  width?: number;
  height?: number;
  /** Set when the source was larger than the target and got scaled down. */
  resized?: boolean;
  /** Approximate stored size. Measured on web, where the bytes are in hand. */
  bytes?: number;
  /** Approximate size of the thumb. Measured on web only, as above. */
  thumbBytes?: number;
  /**
   * The smaller renditions, widest first.
   *
   * The ladder the client chooses from. `imageUri` is the top of the ladder and
   * is not repeated in here.
   */
  variants?: Array<{ width: number; uri: string }>;
}

/**
 * Picks images and converts them to storable URIs at `size`.
 *
 * The conversion failures are reported per image rather than thrown: a batch
 * where four of five land is worth keeping, and telling the user which one
 * failed is more use than losing the whole batch to one bad file.
 */
export async function pickImages(
  max: number,
  size: ImportSizeId = DEFAULT_IMPORT_SIZE,
  onProgress?: (done: number, total: number) => void
): Promise<PickedImage[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return [{ uri: '', problem: 'Photo library access is needed to import pictures.' }];
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: max > 1,
    selectionLimit: max,
    // The resampler handles compression, and only after it has scaled the image
    // down. Compressing here would throw away detail at full size first.
    quality: 1,
    // Base64 is not requested. It used to be, because web stored the bytes
    // directly; now the resampler reads whatever URI the picker hands back and
    // produces the data URI itself, so asking for a second copy of every image
    // in memory buys nothing on either platform.
  });

  if (result.canceled) return [];

  const targetWidth = importSizeWidth(size);

  // One at a time, deliberately. On web each image is decoded into a canvas at
  // its full source resolution before being scaled down, so a twelve megapixel
  // photo costs roughly fifty megabytes of buffer for that single pass. Running
  // a whole batch of those concurrently is how an import tab runs out of memory
  // and dies with no explanation, and it is also why the wait has to be
  // reported as progress rather than as an indeterminate spinner.
  const images: PickedImage[] = [];
  for (const asset of result.assets.slice(0, max)) {
    images.push(await toStorableImage(asset, targetWidth, size === 'auto'));
    onProgress?.(images.length, Math.min(result.assets.length, max));
  }
  return images;
}

/**
 * Converts already-picked images into storable URIs, at the profile photo width.
 *
 * The profile photo picker used to skip this entirely and store `asset.uri`
 * verbatim. On web that is the original file as a base64 data URI: a 12
 * megapixel photo became a nine-megabyte PNG in a text column, and the two
 * profile photos in the database were eighteen megabytes between them.
 *
 * Going through the same resampler as the gallery makes them JPEG at a width
 * that covers the deck card, which is roughly forty-five times smaller.
 */
export async function importProfilePhotos(
  assets: ImagePicker.ImagePickerAsset[]
): Promise<PickedImage[]> {
  const images: PickedImage[] = [];
  for (const asset of assets) {
    images.push(await toStorableImage(asset, PROFILE_PHOTO_WIDTH, false));
  }
  return images;
}

/**
 * Whether the stored bytes have to be inlined rather than referenced.
 *
 * Only true in a browser, where the resampler hands back a data URI. On device
 * it writes a `file://` path into the media cache, which is durable for the
 * life of the install, and inlining it would bloat the store by a third for
 * nothing.
 *
 * Read per call rather than cached in a module constant: the platform does not
 * change at runtime, but a value frozen at import time is the kind of thing
 * that quietly becomes untestable and then quietly becomes wrong.
 */
function inlinesBytes(): boolean {
  return Platform.OS === 'web';
}

/**
 * The raw size of an encoded image.
 *
 * Only measurable where the bytes are actually in the URI. On device the
 * resampler writes a file and reading its length back would mean opening it
 * again, which is not worth doing to fill in a label.
 */
function rawBytesOf(uri: string): number | null {
  if (!inlinesBytes()) return null;
  // base64 is four characters per three bytes.
  return Math.round((uri.length * 3) / 4);
}

/**
 * Encodes an image at a target width, never upscaling.
 *
 * The resampler scales to whatever width it is given, so asking for more than
 * the source has would upscale it and produce a larger, blurrier file. A
 * picker that does not report a width is treated as small for the same
 * reason: never upscaling is the recoverable mistake, an oversized file is
 * not.
 */
async function encodeAt(
  asset: ImagePicker.ImagePickerAsset,
  targetWidth: number
): Promise<{ uri: string; width: number; height: number } | null> {
  const sourceWidth = asset.width ?? 0;
  const resized = sourceWidth > targetWidth;

  try {
    return await manipulateAsync(asset.uri, resized ? [{ resize: { width: targetWidth } }] : [], {
      compress: COMPRESS,
      format: SaveFormat.JPEG,
    });
  } catch {
    return null;
  }
}

/**
 * The width to encode at first.
 *
 * Never wider than the source -- the resampler would upscale, producing a
 * larger and blurrier file -- and never wider than the cap.
 */
export function initialWidth(sourceWidth: number, targetWidth: number): number {
  if (sourceWidth <= 0) return targetWidth;
  return Math.min(targetWidth, sourceWidth);
}

/**
 * The width to try next when the encoded image is over the byte budget.
 *
 * JPEG size scales with *area*, not width, so the width factor is the square
 * root of the byte ratio. Pure arithmetic, and therefore unit-testable without
 * the native resampler -- which is the only part of this file that needs one.
 *
 * Returns null when there is nowhere left to go, which means either the image
 * is already at the smallest width worth keeping or another attempt would not
 * help.
 */
export function narrowedWidth(
  currentWidth: number,
  rawBytes: number,
  budget: number,
  floorWidth: number
): number | null {
  if (rawBytes <= budget) return null;

  const factor = Math.sqrt(budget / rawBytes);
  const next = Math.max(floorWidth, Math.floor(currentWidth * factor));

  // No progress means no point retrying.
  if (next >= currentWidth) return null;
  return next;
}

async function toStorableImage(
  asset: ImagePicker.ImagePickerAsset,
  targetWidth: number,
  auto: boolean
): Promise<PickedImage> {
  if (!asset.uri) return { uri: '', problem: 'That image could not be read.' };

  const sourceWidth = asset.width ?? 0;

  let width = initialWidth(sourceWidth, targetWidth);

  let stored = await encodeAt(asset, width);
  if (!stored) return { uri: '', problem: 'That image could not be resized.' };

  /*
   * Automatic sizing: if the result is over the byte budget, scale the width
   * down and encode again.
   *
   * JPEG size scales with *area*, not width, so the width factor is the square
   * root of the byte ratio. One retry is normally enough because the first
   * attempt is already at the cap rather than at the source width -- a 12
   * megapixel photo at 2880 wide is about 750KB, well inside the budget. The
   * second attempt is there for the pathological case.
   *
   * The loop is bounded at two attempts on purpose. Each one is a full decode
   * and re-encode of a large image, and on web that is the slowest thing in the
   * import. An unbounded "keep shrinking until it fits" loop turns one huge
   * photo into a long stall.
   */
  if (auto) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bytes = rawBytesOf(stored.uri);
      if (bytes === null) break;

      const nextWidth = narrowedWidth(width, bytes, MAX_BYTES, THUMB_WIDTH);
      if (nextWidth === null) break;

      width = nextWidth;
      const smaller = await encodeAt(asset, width);
      if (!smaller) break;
      stored = smaller;
    }
  }

  const image: PickedImage = {
    uri: stored.uri,
    // The full image's dimensions, not the source's. The viewer sizes its card
    // from these, and it is what the viewer actually shows.
    width: stored.width,
    height: stored.height,
    resized: sourceWidth > width,
  };

  // The ladder is derived from the full image rather than from the original.
  // Re-encoding an already-compressed JPEG a second time from the source would
  // pay the generation loss twice, and on web it would decode the full-size
  // buffer twice over.
  const ladder = await makeLadder(stored, width);
  if (ladder.length > 0) {
    image.variants = ladder.map((variant) => ({ width: variant.width, uri: variant.uri }));
    const smallest = ladder[ladder.length - 1];
    if (smallest) {
      image.thumbUri = smallest.uri;
      image.thumbBytes = smallest.bytes;
    }
  }

  // Only measurable where the bytes are actually in the URI. On device the
  // resampler writes a file and reading its length back would mean opening it
  // again, which is not worth doing to fill in a label.
  //
  // `bytes` stays in base64 characters, which is the length of the stored URI.
  // That is the convention the import screen's label divides by 1365 to get
  // back to a readable KB figure, and it is what the string in the database
  // actually costs. `rawBytesOf` above is the raw size, which is what the
  // budget is judged against -- a different number for a different question.
  const raw = rawBytesOf(stored.uri);
  if (raw !== null) {
    if (raw > MAX_BYTES) {
      return { uri: '', problem: 'That image is still too large to store. Try a smaller size.' };
    }
    image.bytes = stored.uri.length;
  }

  return image;
}

/**
 * The renditions below the full image, widest first.
 *
 * Every rung is derived from the full image rather than from the original, for
 * the reason above: re-encoding an already-compressed JPEG a second time from
 * the source would pay the generation loss twice.
 *
 * A rung is skipped when the full image is already no wider than it -- a second
 * file that is not meaningfully smaller is not a rendition, it is storage spent
 * twice on the same pixels.
 */
async function makeLadder(
  full: { uri: string; width: number },
  fullTargetWidth: number
): Promise<Array<{ width: number; uri: string; bytes?: number }>> {
  const wanted = VARIANT_WIDTHS.filter((width) => width < full.width);

  // An import at Grid already produced a tile-sized file. Re-deriving one from
  // it would save nothing and cost a second encode.
  if (fullTargetWidth <= THUMB_WIDTH) wanted.length = 0;

  const ladder: Array<{ width: number; uri: string; bytes?: number }> = [];

  for (const width of wanted) {
    try {
      const rendition = await manipulateAsync(full.uri, [{ resize: { width } }], {
        compress: COMPRESS,
        format: SaveFormat.JPEG,
      });
      ladder.push({
        width,
        uri: rendition.uri,
        bytes: inlinesBytes() ? rendition.uri.length : undefined,
      });
    } catch {
      // Not fatal. The client falls back to the full image, which is exactly
      // what every post imported before this change does anyway, so losing a
      // rung costs memory rather than breaking the photo.
    }
  }

  return ladder;
}

/** How many images one import may add, so a single paste cannot fill the store. */
export const MAX_IMPORT_BATCH = APP_CONFIG.MAX_POST_IMPORT;
