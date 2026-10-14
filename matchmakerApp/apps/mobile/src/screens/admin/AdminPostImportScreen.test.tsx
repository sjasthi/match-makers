import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor as rtlWaitFor,
} from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AdminPostImportScreen } from '@/screens/admin/AdminPostImportScreen';
import { mockDb } from '@/services/mock/database';
import { setActiveAuthMode } from '@/services/auth';
import { useAuthStore } from '@/stores/authStore';
import { pickImages, type PickedImage } from '@/services/imageImport';
import type { ProfileStackParamList } from '@/navigation/types';

jest.setTimeout(60_000);

const Stack = createNativeStackNavigator<ProfileStackParamList>();

jest.mock('@/services/imageImport', () => {
  const actual = jest.requireActual('@/services/imageImport');
  return { ...actual, pickImages: jest.fn() };
});

const pick = pickImages as jest.MockedFunction<typeof pickImages>;

/**
 * RNTL's `waitFor` defaults to a 1000 ms budget, which is not enough for a test
 * that renders a screen and reads the mock database. Under parallel-worker load
 * that is not a slow test, it is a failure that only appears on a loaded
 * machine, so every wait in this file gets a real budget.
 */
function waitFor(callback: () => unknown, options?: { timeout?: number }) {
  return rtlWaitFor(callback, { timeout: 30_000, ...options });
}

function renderAdmin() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="AdminPostImport" component={AdminPostImportScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** A picked image as the importer returns one, already scaled. */
function image(width: number, resized: boolean, bytes?: number): PickedImage {
  return { uri: `file:///cache/${width}.jpg`, width, height: Math.round(width * 0.75), resized, bytes };
}

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null, authMode: 'mock' });
  await mockDb.reset();
  pick.mockReset();
  pick.mockResolvedValue([]);
});

afterEach(async () => {
  cleanup();
  await setActiveAuthMode('mock');
});

describe('choosing an import size', () => {
  it('offers the three widths and starts on the full-screen one', async () => {
    renderAdmin();

    await waitFor(() => expect(screen.getByTestId('admin-import-size')).toBeTruthy());

    expect(screen.getByText('Grid · 640 px')).toBeTruthy();
    expect(screen.getByText('Feed · 1200 px')).toBeTruthy();
    expect(screen.getByText('Large · 2048 px')).toBeTruthy();
  });

  it('passes the chosen size to the importer', async () => {
    pick.mockResolvedValue([image(640, true)]);
    renderAdmin();

    await waitFor(() => expect(screen.getByTestId('admin-import-size')).toBeTruthy());
    fireEvent.press(screen.getByText('Grid · 640 px'));
    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));

    // The size has to reach the importer, because that is where the scaling
    // happens. Selecting it in the UI and never applying it would leave the
    // admin picking a size that does nothing.
    await waitFor(() =>
      expect(pick).toHaveBeenCalledWith(expect.any(Number), 'grid', expect.any(Function))
    );
  });

  it('defaults to the feed width when nothing is chosen', async () => {
    pick.mockResolvedValue([image(1200, true)]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));

    await waitFor(() =>
      expect(pick).toHaveBeenCalledWith(expect.any(Number), 'feed', expect.any(Function))
    );
  });

  it('says a size only applies to the next pick, rather than silently doing nothing', async () => {
    pick.mockResolvedValue([image(1200, true)]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));
    await waitFor(() => expect(screen.getByText(/1200 px wide/)).toBeTruthy());

    // The already-imported images cannot be un-resized in place, and silently
    // applying a new size to nothing is how an admin ends up with a library at
    // two different resolutions without knowing.
    fireEvent.press(screen.getByText('Grid · 640 px'));
    await waitFor(() => expect(screen.getByText(/Choose different photos to apply 640 px/)).toBeTruthy());
  });
});

describe('reporting what a batch cost', () => {
  it('says what the photos were scaled to', async () => {
    pick.mockResolvedValue([image(640, true), image(640, true)]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));

    await waitFor(() => expect(screen.getByText(/640 px wide/)).toBeTruthy());
    // Without the "scaled down" count an admin cannot tell whether their files
    // were already small or the app quietly shrank them.
    expect(screen.getByText(/2 of 2 scaled down/)).toBeTruthy();
  });

  it('leaves out the scaled count when nothing needed scaling', async () => {
    pick.mockResolvedValue([image(400, false)]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));

    await waitFor(() => expect(screen.getByText(/400 px wide/)).toBeTruthy());
    expect(screen.queryByText(/scaled down/)).toBeNull();
  });

  it('converts the stored bytes into something readable', async () => {
    pick.mockResolvedValue([image(1200, true, 1_365_000)]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));

    await waitFor(() => expect(screen.getByText(/about 1\.0 MB stored/)).toBeTruthy());
  });

  it('omits the byte count where the importer cannot measure it', async () => {
    // On device the resampler writes a file, and its length is not read back,
    // so the label has to be omitted rather than shown as zero.
    pick.mockResolvedValue([image(1200, true)]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));

    await waitFor(() => expect(screen.getByText(/1200 px wide/)).toBeTruthy());
    expect(screen.queryByText(/stored/)).toBeNull();
  });
});

describe('resizing a batch', () => {
  it('says which photo it is on rather than spinning indefinitely', async () => {
    // The batch is held open deliberately. Progress is cleared when the import
    // finishes, so a mock that resolves in the same tick would clear it before
    // anything could ever have observed it.
    let release!: () => void;
    pick.mockImplementation(
      (_max, _size, onProgress) =>
        new Promise((resolve) => {
          onProgress?.(2, 5);
          release = () => resolve([]);
        })
    );
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));

    // Scaling a batch of camera files is slow enough that an indeterminate
    // spinner reads as a hang rather than as work.
    await waitFor(() => expect(screen.getByTestId('admin-import-progress')).toBeTruthy());
    expect(screen.getByText('Resizing 2 of 5')).toBeTruthy();

    release();
  });
});

describe('rejected images', () => {
  it('still shows the ones that worked', async () => {
    pick.mockResolvedValue([
      image(640, true),
      { uri: '', problem: 'That image could not be resized.' },
    ]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));

    await waitFor(() => expect(screen.getByText('That image could not be resized.')).toBeTruthy());
    // The batch is worth keeping if four of five land.
    expect(screen.getByText('PHOTOS (1)')).toBeTruthy();
  });
});

describe('what actually gets stored', () => {
  /** Renders, picks one image, tags it and submits, then returns the post. */
  async function importOne(image: PickedImage) {
    pick.mockResolvedValue([image]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Choose up to 12 photos')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-import-choose'));
    await waitFor(() => expect(screen.getByTestId('admin-import-tag-input')).toBeTruthy());

    // Routed through the same testids TagInput's own tests use, because the
    // field is driven by submitEditing rather than by a blur.
    fireEvent.changeText(screen.getByTestId('admin-import-tag-input-field'), 'dog');
    fireEvent(screen.getByTestId('admin-import-tag-input-field'), 'submitEditing');

    await waitFor(() =>
      expect(screen.getByTestId('admin-import-submit').props.accessibilityState?.disabled).toBe(
        false
      )
    );
    fireEvent.press(screen.getByTestId('admin-import-submit'));

    // The seeded library is already populated with posts that have no image at
    // all, so this waits for the write to actually land rather than reading the
    // last row and finding a seed.
    await waitFor(async () => {
      const posts = await mockDb.allPosts();
      expect(posts.some((post) => post.imageUri === image.uri)).toBe(true);
    });

    const posts = await mockDb.allPosts();
    return posts.find((post) => post.imageUri === image.uri);
  }

  it('stores the full image and the grid copy under their own keys', async () => {
    const post = await importOne({
      uri: 'file:///cache/1200.jpg',
      thumbUri: 'file:///cache/640.jpg',
      width: 1200,
      height: 900,
      resized: true,
    });

    // The whole point of the change: the grid and the viewer need different
    // files, and that only works if both survive the write.
    expect(post?.imageUri).toBe('file:///cache/1200.jpg');
    expect(post?.thumbUri).toBe('file:///cache/640.jpg');
    expect(post?.width).toBe(1200);
    expect(post?.height).toBe(900);
  });

  it('stores no thumb key at all when the importer produced none', async () => {
    const post = await importOne({ uri: 'file:///cache/640.jpg', width: 640, height: 480 });

    // An empty-string thumb would send the grid to a file that does not exist,
    // which is worse than falling back to the full image.
    expect(post).toBeDefined();
    expect('thumbUri' in (post as object)).toBe(false);
  });
});
