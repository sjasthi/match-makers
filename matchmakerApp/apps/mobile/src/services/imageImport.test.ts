import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { pickImages, importSizeWidth, IMPORT_SIZES, DEFAULT_IMPORT_SIZE } from './imageImport';

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  manipulateAsync: jest.fn(),
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const resize = manipulateAsync as jest.MockedFunction<typeof manipulateAsync>;

function granted() {
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: true,
    status: 'granted',
  } as never);
}

/**
 * A picked asset as the picker produces it, source dimensions included.
 *
 * The dimensions go into the URI because a batch is converted concurrently. A
 * stub reading a single shared variable would answer every image in the batch
 * with whichever asset happened to be created last, which quietly turns a
 * no-resize case into an apparently scaled one.
 */
function asset(width: number, height: number, uri = `file:///picked/${width}x${height}.jpg`) {
  return { uri, width, height } as ImagePicker.ImagePickerAsset;
}

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  granted();
  // Stands in for the resampler: records what it was asked for and returns an
  // image at whatever width it was told to produce.
  resize.mockImplementation(async (uri, actions) => {
    const action = actions?.[0] as { resize?: { width?: number } } | undefined;
    const [, from, to] = /(\d+)x(\d+)\.jpg$/.exec(uri) ?? [];
    const sourceWidth = Number(from);
    const sourceHeight = Number(to);
    const width = action?.resize?.width ?? sourceWidth;
    return {
      uri: `file:///cache/${width}.jpg`,
      width,
      height: Math.round((width * sourceHeight) / sourceWidth),
    };
  });
});

describe('target sizes', () => {
  it('offers the widths the app actually renders at', () => {
    expect(IMPORT_SIZES.map((size) => size.width)).toEqual([640, 1200, 2048]);
  });

  it('defaults to the full-screen width rather than the grid one', () => {
    // The grid tile is a third of the card, so importing at grid size would
    // make the full-screen viewer soft. Feed is the one that has to work.
    expect(importSizeWidth(DEFAULT_IMPORT_SIZE)).toBe(1200);
  });

  it('falls back to the default for an unknown id', () => {
    // A stored preference could outlive a preset being renamed.
    expect(importSizeWidth('nonsense' as never)).toBe(1200);
  });
});

describe('picking', () => {
  it('reports the permission problem instead of throwing', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
    } as never);

    await expect(pickImages(5)).resolves.toEqual([
      { uri: '', problem: expect.stringContaining('Photo library') },
    ]);
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns nothing when the picker is cancelled', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null } as never);

    await expect(pickImages(5)).resolves.toEqual([]);
  });

  it('caps the batch', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: Array.from({ length: 9 }, () => asset(4000, 3000)),
    } as never);

    await expect(pickImages(3)).resolves.toHaveLength(3);
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ selectionLimit: 3, allowsMultipleSelection: true })
    );
  });

  it('asks the picker not to compress, because the resampler does it after resizing', async () => {
    // Compressing first would throw away detail at 4000px, and then the resample
    // would scale up the damage. The whole point of resizing is to discard the
    // pixels, so it has to happen first.
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset(4000, 3000)],
    } as never);

    await pickImages(5);

    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 1 })
    );
  });
});

describe('resizing', () => {
  beforeEach(() => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset(4000, 3000)],
    } as never);
  });

  it('scales a camera-sized photo down to the target width', async () => {
    const [image] = await pickImages(5, 'grid');

    expect(resize).toHaveBeenCalledWith(
      'file:///picked/4000x3000.jpg',
      [{ resize: { width: 640 } }],
      expect.objectContaining({ format: SaveFormat.JPEG })
    );
    expect(image?.width).toBe(640);
    expect(image?.height).toBe(480);
    expect(image?.resized).toBe(true);
  });

  it('never upscales an image already smaller than the target', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset(500, 400)],
    } as never);

    const [image] = await pickImages(5, 'large');

    // Upscaling would produce a larger and blurrier file than the source. The
    // resampler scales to whatever width it is handed without checking, so
    // asking for a width above the source has to be prevented here.
    expect(resize).toHaveBeenCalledWith('file:///picked/500x400.jpg', [], expect.anything());
    expect(image?.resized).toBe(false);
    expect(image?.width).toBe(500);
  });

  it('treats an image with no reported width as small, for the same reason', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked/4000x3000.jpg' } as ImagePicker.ImagePickerAsset],
    } as never);

    await pickImages(5, 'grid');

    // Guessing "assume it is huge" would upscale every small image; guessing
    // "assume it is small" can only cost an oversized file in the rare case the
    // picker fails to report a dimension, which it does not do in practice.
    expect(resize).toHaveBeenCalledWith('file:///picked/4000x3000.jpg', [], expect.anything());
  });

  it('resizes each image in the batch to its own target', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset(4000, 3000), asset(500, 400), asset(900, 900)],
    } as never);

    const images = await pickImages(5, 'grid');

    expect(images.map((image) => image.width)).toEqual([640, 500, 640]);
    expect(images.map((image) => image.resized)).toEqual([true, false, true]);
  });

  it('converts one at a time, because each holds a full-resolution buffer', async () => {
    let inFlight = 0;
    let peak = 0;
    resize.mockImplementation(async (uri) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const [, from, to] = /(\d+)x(\d+)\.jpg$/.exec(uri) ?? [];
      return { uri, width: Number(from), height: Number(to) };
    });
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: Array.from({ length: 6 }, () => asset(4000, 3000)),
    } as never);

    await pickImages(6);

    // A twelve megapixel photo costs about fifty megabytes inside the resampler.
    // Six of those at once is how an import tab dies with no explanation, so the
    // batch is deliberately serial.
    expect(peak).toBe(1);
  });

  it('reports progress as the batch goes', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: Array.from({ length: 3 }, () => asset(4000, 3000)),
    } as never);
    const seen: Array<[number, number]> = [];

    await pickImages(3, 'grid', (done, total) => seen.push([done, total]));

    // Scaling a batch of camera files is slow enough that an indeterminate
    // spinner reads as a hang rather than as work.
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('rejects one bad image rather than losing the batch', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset(4000, 3000), asset(4000, 3000)],
    } as never);
    resize
      .mockResolvedValueOnce({ uri: 'file:///cache/640.jpg', width: 640, height: 480 })
      .mockRejectedValueOnce(new Error('decode failed'));

    const images = await pickImages(5, 'grid');

    // Four of five landing is worth keeping, and saying which failed is more use
    // than throwing and losing the ones that worked.
    expect(images[0]?.uri).toBe('file:///cache/640.jpg');
    expect(images[1]?.uri).toBe('');
    expect(images[1]?.problem).toContain('could not be resized');
  });

  it('rejects an asset with no URI', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: '', width: 100, height: 100 } as ImagePicker.ImagePickerAsset],
    } as never);

    const [image] = await pickImages(5);

    expect(image?.uri).toBe('');
    expect(image?.problem).toContain('could not be read');
  });
});

describe('the grid thumbnail', () => {
  beforeEach(() => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset(4000, 3000)],
    } as never);
  });

  it('writes a second, smaller copy for the grid', async () => {
    const [image] = await pickImages(5, 'feed');

    // The grid and the viewer want different files. One stored image means either
    // the grid decodes full-size bitmaps ten at a time or the viewer upscales a
    // thumbnail, and on a phone that is the difference between sharp and soft.
    expect(image?.uri).toBe('file:///cache/1200.jpg');
    expect(image?.thumbUri).toBe('file:///cache/640.jpg');
    // Dimensions describe the full image, because that is what the viewer shows.
    expect(image?.width).toBe(1200);
    expect(image?.height).toBe(900);
  });

  it('derives the thumb from the full image, not the original', async () => {
    await pickImages(5, 'feed');

    // A second encode of the original would pay the JPEG generation loss twice,
    // and on web would decode the full-size buffer twice over.
    expect(resize).toHaveBeenNthCalledWith(
      1,
      'file:///picked/4000x3000.jpg',
      [{ resize: { width: 1200 } }],
      expect.anything()
    );
    expect(resize).toHaveBeenNthCalledWith(
      2,
      'file:///cache/1200.jpg',
      [{ resize: { width: 640 } }],
      expect.anything()
    );
  });

  it('writes no thumb when the chosen size is already tile sized', async () => {
    const [image] = await pickImages(5, 'grid');

    // A second file that is not meaningfully smaller is not a thumbnail, it is
    // the same pixels stored twice.
    expect(image?.thumbUri).toBeUndefined();
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it('writes no thumb when the source was already tile sized', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset(600, 400)],
    } as never);

    const [image] = await pickImages(5, 'feed');

    expect(image?.thumbUri).toBeUndefined();
  });

  it('keeps the photo when only the thumbnail fails', async () => {
    resize
      .mockResolvedValueOnce({ uri: 'file:///cache/1200.jpg', width: 1200, height: 900 })
      .mockRejectedValueOnce(new Error('thumb encode failed'));

    const [image] = await pickImages(5, 'feed');

    // Every post written before this change has no thumbnail and renders fine,
    // so losing one costs memory rather than the photo.
    expect(image?.uri).toBe('file:///cache/1200.jpg');
    expect(image?.thumbUri).toBeUndefined();
    expect(image?.problem).toBeUndefined();
  });
});

describe('on web', () => {
  beforeEach(() => {
    Platform.OS = 'web';
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset(4000, 3000)],
    } as never);
  });

  it('measures the stored size, because the bytes are right there', async () => {
    const dataUri = `data:image/jpeg;base64,${'a'.repeat(136_500)}`;
    resize.mockResolvedValue({ uri: dataUri, width: 1200, height: 900 });

    const [image] = await pickImages(5);

    // The whole stored string is what occupies the quota, prefix included. A
    // data URI is base64, a known 4/3 expansion, so this is about 100 KB of
    // JPEG underneath; the import screen divides it back out when it labels it.
    expect(image?.bytes).toBe(dataUri.length);
  });

  it('still rejects an image that busts the quota after resizing', async () => {
    resize.mockResolvedValue({
      uri: `data:image/jpeg;base64,${'a'.repeat(3_000_000)}`,
      width: 1200,
      height: 900,
    });

    const [image] = await pickImages(5);

    // The presets bound a normal photograph, but not a pathological one, and the
    // quota is shared with everything else in the store.
    expect(image?.uri).toBe('');
    expect(image?.problem).toContain('too large');
    expect(image?.problem).toContain('smaller size');
  });

  it('leaves the size unmeasured on device, where the bytes are a file', async () => {
    Platform.OS = 'android';
    resize.mockResolvedValue({ uri: 'file:///cache/1200.jpg', width: 1200, height: 900 });

    const [image] = await pickImages(5);

    // Reading the file back just to fill in a label would mean opening every
    // imported image a second time.
    expect(image?.bytes).toBeUndefined();
  });
});