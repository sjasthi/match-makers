import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor as rtlWaitFor,
} from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { PhotoFeedScreen } from '@/screens/main/PhotoFeedScreen';
import { AdminPostsScreen } from '@/screens/admin/AdminPostsScreen';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { setActiveAuthMode } from '@/services/auth';
import { useAuthStore } from '@/stores/authStore';
import {
  cancelPendingSummaryRefresh,
  SUMMARY_SETTLE_MS,
  usePhotoFeedStore,
  whenPhotoFeedIdle,
} from '@/stores/photoFeedStore';
import { deletePost, importPosts, listAllTags, listPosts } from '@/services/admin';
import { fetchPhotoFeed } from '@/services/posts';
import { MAX_POST_TAGS } from '@match-makers/shared';
import { APP_CONFIG } from '@/constants';
import { buildTasteIndex, tasteBetween } from '@/utils/taste';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import type { ProfileStackParamList, MainTabParamList } from '@/navigation/types';

jest.setTimeout(60_000);

const FEED_PAGE_SIZE = APP_CONFIG.FEED_PAGE_SIZE;

/**
 * The page the grid is on, read from the store.
 *
 * `pagePosts` is a derivation inside `usePhotoFeed`, not store state, and these
 * tests need ids without scraping the DOM for them. Mirroring the slice is better
 * than duplicating the hook's internals in every assertion, and the DOM is still
 * what the "which tiles are on screen" cases check.
 */
function currentPagePosts() {
  const { posts, page, activeTag } = usePhotoFeedStore.getState();
  // Filtering happens before the page cut, so the mirror has to as well.
  const visible = activeTag ? posts.filter((post) => post.tags.includes(activeTag)) : posts;
  return visible.slice(page * FEED_PAGE_SIZE, (page + 1) * FEED_PAGE_SIZE);
}

function currentPageIds(): string[] {
  return currentPagePosts().map((post) => post.id);
}

const Stack = createNativeStackNavigator<ProfileStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * RNTL's `waitFor` defaults to a 1000 ms budget, which is not enough for a test
 * that renders a screen and reads the mock database. Under parallel-worker load
 * that is not a slow test, it is a failure that only appears on a loaded
 * machine, so every wait in this file gets a real budget.
 */
function waitFor(callback: () => unknown, options?: { timeout?: number }) {
  return rtlWaitFor(callback, { timeout: 30_000, ...options });
}


/** The feed tab inside a real tab bar, so the "go to Likes" link has somewhere to go. */
function renderFeed() {
  return render(
    <NavigationContainer>
      <Tab.Navigator>
        <Tab.Screen name="Feed" component={PhotoFeedScreen} options={{ title: 'Photos' }} />
        <Tab.Screen name="Likes" component={() => null} options={{ title: 'Likes' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function renderAdmin() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="AdminPosts" component={AdminPostsScreen} />
        <Stack.Screen name="AdminPostImport" component={() => null} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

async function signInDemo() {
  const adapter = new MockAuthAdapter();
  const result = await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  useAuthStore.setState({ user: result.user, state: 'authenticated', authMode: 'mock' });
  return result.user;
}

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null, authMode: 'mock' });
  usePhotoFeedStore.getState().reset();
  await flushPendingWrites();
  await mockDb.reset();
});

/**
 * Lets fire-and-forget writes land before the next test resets anything.
 *
 * The screen calls `react` without awaiting it, so a write from the previous test
 * would otherwise land after the next test's `mockDb.reset()` and the next test
 * would read reactions it never made. The store counts its own in-flight writes,
 * so this waits for the real thing instead of guessing at macrotask counts.
 */
async function flushPendingWrites() {
  await whenPhotoFeedIdle();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(async () => {
  cleanup();
  await flushPendingWrites();
  // After the wait, not before: a late reaction can schedule a fresh refresh on
  // its way out, and that is held at module scope on purpose.
  cancelPendingSummaryRefresh();
  await setActiveAuthMode('mock');
});

describe('the grid is the landing page', () => {
  /** Taps a tile and waits for the viewer to come up. */
  async function openPhoto(id?: string) {
    const target = id ?? currentPagePosts()[0]?.id ?? '';
    fireEvent.press(screen.getByTestId(`photo-tile-${target}`));
    await waitFor(() => expect(screen.getByTestId('post-viewer-card')).toBeTruthy());
    return target;
  }

  it('shows a wall of photos before anything has been answered', async () => {
    await signInDemo();

    renderFeed();

    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());
    // One page, not the whole library: ten at a time, with a way to the rest.
    expect(screen.getAllByTestId(/^photo-tile-post_\d+$/)).toHaveLength(FEED_PAGE_SIZE);
  });

  it('shows each tile with its tag, which is how a category is found', async () => {
    await signInDemo();
    renderFeed();

    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());
    // A tile reading `dog` is the only affordance saying "there are more of
    // these", since there is no chip row to browse categories with.
    expect(screen.getAllByTestId(/^photo-tile-post_.*-tag$/).length).toBeGreaterThan(0);
  });

  it('opens the viewer on tap, where the tags are readable', async () => {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    await openPhoto();

    expect(screen.getByTestId('post-like')).toBeTruthy();
  });

  /**
   * The reported bug: the close button did nothing.
   *
   * Closing set `viewingId` to null, which produced a negative index, which fell
   * through a fallback and handed the viewer the *first* photo instead of none —
   * so the modal's `visible={post !== null}` never went false and there was no
   * way out.
   */
  it('closes the viewer', async () => {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    await openPhoto();

    fireEvent.press(screen.getByTestId('post-viewer-close'));

    await waitFor(() => expect(screen.queryByTestId('post-viewer-card')).toBeNull());
  });

  it('closes and reopens, so the viewer is not a one-way door', async () => {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const id = await openPhoto();
    fireEvent.press(screen.getByTestId('post-viewer-close'));
    await waitFor(() => expect(screen.queryByTestId('post-viewer-card')).toBeNull());

    await openPhoto(id);
    expect(screen.getByTestId('post-viewer-card')).toBeTruthy();
  });

  it('tells you nothing about anybody yet, rather than inventing it', async () => {
    await signInDemo();
    for (const reaction of await mockDb.allPostReactions()) {
      await mockDb.recordPostReaction(reaction.userId, reaction.postId, 'dislike');
    }

    renderFeed();

    await waitFor(() => expect(screen.getByTestId('taste-summary')).toBeTruthy());
    expect(screen.getByText('WHAT THIS IS FOR')).toBeTruthy();
  });

  it('collapses the summary so the grid gets the height back', async () => {
    await signInDemo();
    renderFeed();

    await waitFor(() => expect(screen.getByTestId('taste-summary-toggle')).toBeTruthy());
    // Open by default: the legibility argument only works if the panel is
    // actually visible.
    expect(usePhotoFeedStore.getState().summaryExpanded).toBe(true);

    fireEvent.press(screen.getByTestId('taste-summary-toggle'));

    await waitFor(() => expect(usePhotoFeedStore.getState().summaryExpanded).toBe(false));
  });

  it('says the library is empty rather than that it is all answered', async () => {
    await signInDemo();
    // Copied first: `allPosts` hands back the live array and `deletePost` splices
    // it, so iterating the result directly deletes every other post.
    for (const post of [...(await mockDb.allPosts())]) {
      await mockDb.deletePost(post.id);
    }

    renderFeed();

    // Two different problems that look identical from the grid alone.
    await waitFor(() => expect(screen.getByText('No photos yet')).toBeTruthy());
  });
});

describe('liking and unliking', () => {
  async function openFirstAndAnswer(testID: 'post-like' | 'post-dislike') {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const target = currentPagePosts()[0]!;
    fireEvent.press(screen.getByTestId(`photo-tile-${target.id}`));
    await waitFor(() => expect(screen.getByTestId('post-viewer-card')).toBeTruthy());

    fireEvent.press(screen.getByTestId(testID));
    return target;
  }

  it('records the reaction and leaves the photo on the grid', async () => {
    const target = await openFirstAndAnswer('post-like');

    await waitFor(async () => {
      const stored = await mockDb.reactedPostIds('user_demo');
      expect(stored.has(target.id)).toBe(true);
    });

    // The tile is still there: answering no longer removes it, because a photo
    // you can change your mind about has to still be on screen to do that.
    expect(screen.getByTestId(`photo-tile-${target.id}`)).toBeTruthy();
    expect(usePhotoFeedStore.getState().posts).toHaveLength(24);
  });

  it('marks the tile as answered', async () => {
    const target = await openFirstAndAnswer('post-like');

    await waitFor(() =>
      expect(screen.getByTestId(`photo-tile-${target.id}-liked`)).toBeTruthy()
    );
  });

  it('pressing the lit button again takes the answer back to default', async () => {
    const target = await openFirstAndAnswer('post-like');
    await waitFor(() => expect(usePhotoFeedStore.getState().reactions[target.id]).toBe('like'));

    fireEvent.press(screen.getByTestId('post-like'));

    // "Default" means no row at all, because the taste index counts rows. A stored
    // marker would still be counted as a reaction.
    await waitFor(async () => {
      const stored = await mockDb.reactedPostIds('user_demo');
      expect(stored.has(target.id)).toBe(false);
    });
    expect(usePhotoFeedStore.getState().reactions[target.id]).toBeUndefined();
    expect(screen.queryByTestId(`photo-tile-${target.id}-liked`)).toBeNull();
  });

  it('flips a pass to a like rather than recording both', async () => {
    const target = await openFirstAndAnswer('post-dislike');
    await waitFor(() => expect(usePhotoFeedStore.getState().reactions[target.id]).toBe('dislike'));

    fireEvent.press(screen.getByTestId('post-like'));

    await waitFor(() => expect(usePhotoFeedStore.getState().reactions[target.id]).toBe('like'));

    // Polled rather than read once. The store updates optimistically, so the tap
    // registering proves nothing about the write behind it, and a single read can
    // catch the row mid-flight still holding the previous answer.
    await waitFor(async () => {
      const rows = (await mockDb.allPostReactions()).filter(
        (entry) => entry.userId === 'user_demo' && entry.postId === target.id
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('like');
    });
  });

  it('undoes the summary alongside the tile', async () => {
    await openFirstAndAnswer('post-like');
    await waitFor(() => expect(usePhotoFeedStore.getState().summary.likes).toBe(1));

    fireEvent.press(screen.getByTestId('post-like'));

    // Otherwise the panel claims a like that the tile two inches above it no
    // longer shows, until the next refetch contradicts it.
    await waitFor(() => expect(usePhotoFeedStore.getState().summary.likes).toBe(0));
  });

  it('records a dislike as a dislike', async () => {
    const target = await openFirstAndAnswer('post-dislike');

    await waitFor(async () => {
      const reactions = (await mockDb.allPostReactions()).filter(
        (entry) => entry.userId === 'user_demo' && entry.postId === target.id
      );
      expect(reactions).toHaveLength(1);
      expect(reactions[0]?.action).toBe('dislike');
    });
    expect(screen.queryByTestId(`photo-tile-${target.id}-liked`)).toBeNull();
  });

  it('keeps page one the same ten photos however much you answer', async () => {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const before = currentPageIds();

    const target = before[0]!;
    fireEvent.press(screen.getByTestId(`photo-tile-${target}`));
    await waitFor(() => expect(screen.getByTestId('post-viewer-card')).toBeTruthy());
    fireEvent.press(screen.getByTestId('post-like'));
    await waitFor(() => expect(usePhotoFeedStore.getState().reactions[target]).toBe('like'));

    // Answered photos stay put rather than sinking away. Re-sorting would read as
    // a work queue but would rearrange the grid on every tap and lose your place.
    expect(currentPageIds()).toEqual(before);
  });
});

describe('pagination', () => {
  async function renderAndPage() {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('photo-page-next')).toBeTruthy());
  }

  it('shows ten photos and a way to the rest', async () => {
    await renderAndPage();

    expect(screen.getAllByTestId(/^photo-tile-post_\d+$/)).toHaveLength(FEED_PAGE_SIZE);
    // 24 seeded photos is three pages.
    expect(screen.getByText('PAGE 1 OF 3')).toBeTruthy();
  });

  it('walks forward and back', async () => {
    await renderAndPage();
    const pageOne = currentPageIds();

    fireEvent.press(screen.getByTestId('photo-page-next'));
    await waitFor(() => expect(screen.getByText('PAGE 2 OF 3')).toBeTruthy());

    const pageTwo = currentPageIds();
    // Different photos, not a repaint of the same ones.
    expect(pageTwo).not.toEqual(pageOne);

    fireEvent.press(screen.getByTestId('photo-page-previous'));
    await waitFor(() => expect(screen.getByText('PAGE 1 OF 3')).toBeTruthy());
    expect(currentPageIds()).toEqual(pageOne);
  });

  it('cannot go past either end', async () => {
    await renderAndPage();

    expect(screen.getByTestId('photo-page-previous').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    for (let click = 0; click < 5; click += 1) {
      fireEvent.press(screen.getByTestId('photo-page-next'));
    }
    await waitFor(() => expect(screen.getByText('PAGE 3 OF 3')).toBeTruthy());

    expect(screen.getByTestId('photo-page-next').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(usePhotoFeedStore.getState().page).toBe(2);
  });

  it('hides the controls when there is only one page', async () => {
    await signInDemo();
    for (const post of [...(await mockDb.allPosts())].slice(FEED_PAGE_SIZE)) {
      await mockDb.deletePost(post.id);
    }

    renderFeed();

    await waitFor(() => expect(screen.getByTestId('photo-grid-page-note')).toBeTruthy());
    expect(screen.queryByTestId('photo-page-next')).toBeNull();
  });

  it('goes back to the first page when the filter changes', async () => {
    await renderAndPage();
    fireEvent.press(screen.getByTestId('photo-page-next'));
    await waitFor(() => expect(screen.getByText('PAGE 2 OF 3')).toBeTruthy());

    const first = currentPagePosts()[0]!;
    fireEvent.press(screen.getByTestId(`photo-tile-${first.id}-tag`));

    // Otherwise a tag with three photos leaves you on a page two that does not
    // exist, showing an empty grid with no explanation.
    await waitFor(() => expect(usePhotoFeedStore.getState().page).toBe(0));
  });
});

describe('filtering by tag', () => {
  it('narrows the grid to one category', async () => {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const first = currentPagePosts()[0]!;
    const tag = first.tags[0]!;

    fireEvent.press(screen.getByTestId(`photo-tile-${first.id}-tag`));

    await waitFor(() => expect(usePhotoFeedStore.getState().activeTag).toBe(tag));
    // The filter line names the category, so a small grid is never mistaken for a
    // small library.
    expect(screen.getByTestId('feed-clear-filter')).toBeTruthy();
    for (const entry of currentPagePosts()) {
      expect(entry.tags).toContain(tag);
    }
  });

  it('clears the filter when the same tag is tapped again', async () => {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const first = currentPagePosts()[0]!;
    fireEvent.press(screen.getByTestId(`photo-tile-${first.id}-tag`));
    await waitFor(() => expect(usePhotoFeedStore.getState().activeTag).toBe(first.tags[0]!));

    // One place to tap doing both things, so there is never a second control to
    // learn and never a filter you cannot tell how to undo.
    fireEvent.press(screen.getByTestId(`photo-tile-${first.id}-tag`));
    await waitFor(() => expect(usePhotoFeedStore.getState().activeTag).toBeNull());
  });

  it('clears the filter from the line under the header', async () => {
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const first = currentPagePosts()[0]!;
    fireEvent.press(screen.getByTestId(`photo-tile-${first.id}-tag`));
    await waitFor(() => expect(screen.getByTestId('feed-clear-filter')).toBeTruthy());

    fireEvent.press(screen.getByTestId('feed-clear-filter'));

    await waitFor(() => expect(usePhotoFeedStore.getState().activeTag).toBeNull());
    expect(screen.queryByTestId('feed-clear-filter')).toBeNull();
  });

  it('never filters down to nothing, because filters come from visible tiles', async () => {
    // A tag can only be tapped on a tile that has it, so a filtered grid always
    // has at least one tile. This is why the old "that category is done" empty
    // state was deleted rather than kept.
    await signInDemo();
    renderFeed();
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    for (const post of currentPagePosts()) {
      fireEvent.press(screen.getByTestId(`photo-tile-${post.id}-tag`));
      await waitFor(() => expect(usePhotoFeedStore.getState().activeTag).toBe(post.tags[0]!));
      expect(screen.getAllByTestId(/^photo-tile-post_\d+$/).length).toBeGreaterThan(0);

      fireEvent.press(screen.getByTestId('feed-clear-filter'));
      await waitFor(() => expect(usePhotoFeedStore.getState().activeTag).toBeNull());
    }
  });
});

describe('cold start', () => {
  it('gives the demo account no answers, so the deck opens marked provisional', async () => {
    await signInDemo();

    // Seeded candidates carry reactions so there is somebody to be pulled towards,
    // but the demo account's taste is whatever they answer themselves. Preseeding
    // it would greet somebody signing in with a history of likes they never gave.
    const reactions = (await mockDb.allPostReactions()).filter(
      (reaction) => reaction.userId === 'user_demo'
    );
    expect(reactions).toHaveLength(0);

    renderFeed();
    await waitFor(() => expect(screen.getByTestId('taste-summary')).toBeTruthy());
    expect(screen.getByText('WHAT THIS IS FOR')).toBeTruthy();
  });
});

describe('co-liking pulls two people together', () => {
  /**
   * The case the whole feature exists for, end to end through the store.
   *
   * Priya and the demo account both like the same photo. The feed stores that,
   * the taste index reads it, and the match layer is told about it. The assertion
   * is on affinity being non-zero, not on a particular number, because the exact
   * value is a tuning decision rather than a correctness one.
   */
  it('scores a pair higher the more of the same photos they liked', async () => {
    const posts = await mockDb.allPosts();
    const others = (await mockDb.allUsers()).filter((user) => user.id !== 'user_demo');
    const priya = others[0]!;

    for (const reaction of await mockDb.allPostReactions()) {
      if (reaction.userId !== priya.id) {
        await mockDb.recordPostReaction(reaction.userId, reaction.postId, 'dislike');
      }
    }

    // Both like the first three photos.
    const shared = posts.slice(0, 3);
    for (const post of shared) {
      await mockDb.recordPostReaction('user_demo', post.id, 'like');
      await mockDb.recordPostReaction(priya.id, post.id, 'like');
    }

    const index = buildTasteIndex(await mockDb.allPostReactions(), posts);
    const signal = tasteBetween(index, 'user_demo', priya.id);

    expect(signal.coLikedPosts).toBe(3);
    expect(signal.affinity).toBeGreaterThan(0);
    expect(signal.reason).toContain('You both liked');
  });

  it('leaves an unrelated pair alone', async () => {
    const posts = await mockDb.allPosts();
    const others = (await mockDb.allUsers()).filter((user) => user.id !== 'user_demo');
    const stranger = others[1]!;

    for (const reaction of await mockDb.allPostReactions()) {
      if (reaction.userId !== 'user_demo') {
        await mockDb.recordPostReaction(reaction.userId, reaction.postId, 'dislike');
      }
    }
    await mockDb.recordPostReaction('user_demo', posts[0]!.id, 'like');

    const index = buildTasteIndex(await mockDb.allPostReactions(), posts);
    expect(tasteBetween(index, 'user_demo', stranger.id).affinity).toBe(0);
  });
});

describe('the coalesced summary refresh', () => {
  /**
   * A refresh queued for a session that has ended must not resolve into the next
   * one.
   *
   * Cancelling the timer is not sufficient: a reaction whose write is still in
   * flight queues a *fresh* timer after the reset has run, and that timer then
   * reads whatever database the new session is looking at and writes the answer
   * into its store. Signing out and back in is enough to trigger it in the app.
   */
  it('does not carry a queued summary into a reset store', async () => {
    await signInDemo();
    await importPosts([
      { imageUri: 'file:///tmp/a.jpg', tags: ['dog'] },
      { imageUri: 'file:///tmp/b.jpg', tags: ['dog'] },
    ]);

    const posts = [...(await mockDb.allPosts())];
    usePhotoFeedStore.getState().reset();
    usePhotoFeedStore.setState({
      posts,
      total: posts.length,
      state: 'success',
    });

    // Answering queues a refresh for 800ms. Real timers rather than fake ones,
    // because the write itself waits on a timer and faking them deadlocks it.
    void usePhotoFeedStore.getState().react(posts[0]!.id, 'like');
    await whenPhotoFeedIdle();
    expect(usePhotoFeedStore.getState().summary.likes).toBe(1);

    // The store resets while that refresh is still queued: signing out.
    usePhotoFeedStore.getState().reset();
    await new Promise((resolve) => setTimeout(resolve, SUMMARY_SETTLE_MS + 250));

    // Nothing from the dead session may reappear in the new one.
    expect(usePhotoFeedStore.getState().summary.likes).toBe(0);
    expect(usePhotoFeedStore.getState().posts).toEqual([]);
  });
});

describe('admin photo library', () => {
  it('lists what is in the library with its reaction counts', async () => {
    await signInDemo();
    renderAdmin();

    await waitFor(() => expect(screen.getByTestId('admin-posts-list')).toBeTruthy());
    expect(await screen.findByText(/PHOTOS/)).toBeTruthy();
  });

  it('imports a tagged photo and shows it in the feed immediately', async () => {
    await signInDemo();
    // Copied: `allPosts` hands back the live array, so holding the result across
    // an import means `before` and `after` are the same object.
    const before = [...(await mockDb.allPosts())];

    await importPosts([
      { imageUri: 'file:///tmp/cat.jpg', tags: ['pets', 'animals'] },
    ]);

    const after = await mockDb.allPosts();
    expect(after.length).toBe(before.length + 1);
    // Stored folded, so `pets` cannot sit in the library as a tag nothing else
    // will ever match.
    expect(after[after.length - 1]?.tags).toEqual(['pet', 'animal']);

    const page = await fetchPhotoFeed();
    expect(page.posts.some((post) => post.imageUri === 'file:///tmp/cat.jpg')).toBe(true);
    // And it lands in the feed with both tags, in order, first one primary.
    expect(page.posts.find((post) => post.imageUri === 'file:///tmp/cat.jpg')?.tags).toEqual([
      'pet',
      'animal',
    ]);
  });

  it('refuses an untagged photo, because it could never be matched on', async () => {
    await signInDemo();
    const before = (await mockDb.allPosts()).length;

    await expect(
      importPosts([{ imageUri: 'file:///tmp/cat.jpg', tags: [] }])
    ).rejects.toThrow(/tag and press enter/i);
    expect((await mockDb.allPosts()).length).toBe(before);
  });

  it('refuses more tags than the schema allows', async () => {
    await signInDemo();
    const tooMany = Array.from({ length: MAX_POST_TAGS + 1 }, (_, index) => `tag${index}`);

    // The cap keeps the primary tag meaningful. Eight is enough to describe a
    // photo; nine ways starts to mean it has no subject.
    await expect(
      importPosts([{ imageUri: 'file:///tmp/cat.jpg', tags: tooMany }])
    ).rejects.toThrow(/at most 8 tags/i);
  });

  it('normalises typed tags on the way in, so the library converges', async () => {
    await signInDemo();

    await importPosts([
      { imageUri: 'file:///tmp/a.jpg', tags: ['Dogs'] },
      { imageUri: 'file:///tmp/b.jpg', tags: ['DOGS', '  dog ', 'baking'] },
    ]);

    // `Dogs`, `DOGS` and `dog` are one tag, and the duplicate inside the second
    // photo collapses too. Left unfolded they would each be a separate entry in
    // `listAllTags` and a separate key in the taste index, so the tag-level
    // signal would quietly stop working between people who typed it differently.
    expect(await listAllTags()).toContainEqual({ tag: 'dog', count: 2 });
    expect(await listAllTags()).toContainEqual({ tag: 'baking', count: 1 });
  });

  it('deleting a post also drops the reactions that pointed at it', async () => {
    await signInDemo();
    const post = (await mockDb.allPosts())[0]!;

    const listed = await listPosts();
    expect(listed.find((entry) => entry.post.id === post.id)?.likes).toBeGreaterThan(0);

    await deletePost(post.id);

    expect((await mockDb.allPostReactions()).some((entry) => entry.postId === post.id)).toBe(false);
  });
});