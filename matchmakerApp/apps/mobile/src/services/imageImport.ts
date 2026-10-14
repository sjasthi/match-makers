import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { APP_CONFIG } from '@/constants';

/**
 * Turning a picked image into something that survives being written to storage.
 *
 * The admin is a curator importing photographs off a camera, so the source
 * images are 12-48 megapixel files several megabytes each. Storing those
 * verbatim does not work: on web the bytes are inlined into AsyncStorage as a
 * data URI, where a single unresized photo can exceed the whole quota, and on
 * device it makes the feed decode enormous bitmaps for tiles two hundred pixels
 * wide.
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

/** Compression for everything written to the library. */
const COMPRESS = 0.8;

/** Guard so one enormous image cannot fill the whole store and break the app. */
const MAX_BYTES = 1_500_000;

/**
 * Width of the grid-sized copy, written alongside every import.
 *
 * Not a preset, because the grid is not a choice the admin makes. A masonry tile
 * is about 160 points wide, so 640 covers it at 3x with nothing to spare.
 */
const THUMB_WIDTH = 640;

/**
 * Target widths an admin can import at.
 *
 * These are the sizes the app actually renders at, so choosing one is a choice
 * about where the image will be looked at rather than an abstract quality dial.
 * A masonry tile is about two hundred points wide and the full-screen card is
 * about four hundred, so 640 covers the grid at 3x and 1200 covers the card at
 * 3x. 2048 is for tablets and for anyone who would rather spend the space.
 */
export const IMPORT_SIZES = [
  { id: 'grid', label: 'Grid', detail: '640 px', width: 640 },
  { id: 'feed', label: 'Feed', detail: '1200 px', width: 1200 },
  { id: 'large', label: 'Large', detail: '2048 px', width: 2048 },
] as const;

export type ImportSizeId = (typeof IMPORT_SIZES)[number]['id'];

export const DEFAULT_IMPORT_SIZE: ImportSizeId = 'feed';

/** The target width for an id, falling back to the default for a stale value. */
export function importSizeWidth(id: ImportSizeId): number {
  return IMPORT_SIZES.find((size) => size.id === id)?.width ?? 1200;
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
    images.push(await toStorableImage(asset, targetWidth));
    onProgress?.(images.length, Math.min(result.assets.length, max));
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

async function toStorableImage(
  asset: ImagePicker.ImagePickerAsset,
  targetWidth: number
): Promise<PickedImage> {
  if (!asset.uri) return { uri: '', problem: 'That image could not be read.' };

  // The resampler scales to whatever width it is given, so asking for more than
  // the source has would upscale it and produce a larger, blurrier file. A
  // picker that does not report a width is treated as small for the same
  // reason: never upscaling is the recoverable mistake, an oversized file is
  // not.
  const sourceWidth = asset.width ?? 0;
  const resized = sourceWidth > targetWidth;

  let stored: { uri: string; width: number; height: number };
  try {
    stored = await manipulateAsync(
      asset.uri,
      resized ? [{ resize: { width: targetWidth } }] : [],
      { compress: COMPRESS, format: SaveFormat.JPEG }
    );
  } catch {
    return { uri: '', problem: 'That image could not be resized.' };
  }

  const image: PickedImage = {
    uri: stored.uri,
    // The full image's dimensions, not the source's. The viewer sizes its card
    // from these, and it is what the viewer actually shows.
    width: stored.width,
    height: stored.height,
    resized,
  };

  // The grid copy is derived from the full one rather than from the original.
  // Re-encoding an already-compressed JPEG a second time from the source would
  // pay the generation loss twice, and on web it would decode the full-size
  // buffer twice over.
  const thumb = await makeThumb(stored, targetWidth);
  if (thumb) {
    image.thumbUri = thumb.uri;
    image.thumbBytes = thumb.bytes;
  }

  // Only measurable where the bytes are actually in the URI. On device the
  // resampler writes a file and reading its length back would mean opening it
  // again, which is not worth doing to fill in a label.
  if (inlinesBytes()) {
    const bytes = stored.uri.length;
    // A data URI is base64, a known 4/3 expansion of the raw bytes, and this
    // only needs to catch a photograph that would still blow the quota after
    // being scaled to the largest preset offered.
    if (bytes > MAX_BYTES * 1.4) {
      return { uri: '', problem: 'That image is still too large to store. Try a smaller size.' };
    }
    image.bytes = bytes;
  }

  return image;
}

/**
 * The grid-sized copy of an already-converted image.
 *
 * Skipped entirely when the full image is already no wider than a tile needs. A
 * second file that is not meaningfully smaller is not a thumbnail, it is just
 * storage spent twice on the same pixels.
 */
async function makeThumb(
  full: { uri: string; width: number },
  fullTargetWidth: number
): Promise<{ uri: string; bytes?: number } | null> {
  // An import at Grid already produced a tile-sized file. Re-deriving one from
  // it would save nothing and cost a second encode.
  if (fullTargetWidth <= THUMB_WIDTH || full.width <= THUMB_WIDTH) return null;

  try {
    const thumb = await manipulateAsync(
      full.uri,
      [{ resize: { width: THUMB_WIDTH } }],
      { compress: COMPRESS, format: SaveFormat.JPEG }
    );
    return { uri: thumb.uri, bytes: inlinesBytes() ? thumb.uri.length : undefined };
  } catch {
    // Not fatal. The grid falls back to the full image, which is exactly what
    // every post imported before this change does anyway, so losing a thumbnail
    // costs memory rather than breaking the photo.
    return null;
  }
}

/** How many images one import may add, so a single paste cannot fill the store. */
export const MAX_IMPORT_BATCH = APP_CONFIG.MAX_POST_IMPORT;