import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor as rtlWaitFor,
} from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { LikesScreen } from '@/screens/main/LikesScreen';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { useAuthStore } from '@/stores/authStore';
import { useFeedStore } from '@/stores/feedStore';
import { usePhotoFeedStore } from '@/stores/photoFeedStore';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import { mutualGate } from '@/utils/eligibility';
import type { MainTabParamList, RootStackParamList } from '@/navigation/types';

jest.setTimeout(60_000);

const Tabs = createBottomTabNavigator<MainTabParamList>();
const Root = createNativeStackNavigator<RootStackParamList>();

function waitFor<T>(callback: () => T, options?: { timeout?: number }): Promise<T> {
  return rtlWaitFor(callback, { timeout: 30_000, ...options });
}

/** The Likes tab inside a bare tab bar, in a bare root stack, with nothing else rendered. */
function renderLikes() {
  return render(
    <NavigationContainer>
      <Root.Navigator>
        <Root.Screen name="Main" component={TabsScreen} />
        <Root.Screen name="Profile" component={ProfileStub} />
      </Root.Navigator>
    </NavigationContainer>
  );
}

/** Stand-ins so navigation targets exist without rendering them. */
function FeedStub() {
  return null;
}
function ProfileStub() {
  return null;
}

function TabsScreen() {
  return (
    <Tabs.Navigator initialRouteName="Likes">
      <Tabs.Screen name="Feed" component={FeedStub} />
      <Tabs.Screen name="Likes" component={LikesScreen} />
    </Tabs.Navigator>
  );
}

async function signInDemo() {
  await mockDb.reset();
  const adapter = new MockAuthAdapter();
  const result = await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  // The adapter does not touch the store; the app's bootstrap does that. Without
  // this the screen waits on a viewer that never arrives.
  useAuthStore.setState({ user: result.user, state: 'authenticated', authMode: 'mock' });
}

/**
 * Builds a deterministic strong-match deck.
 *
 * The Likes deck only carries cards at 80%+, and the mock scores live from the
 * reactions table, so a single like no longer fills a grid. Here the demo and
 * two eligible candidates all like the same six photos, which lands each pair
 * at `0.65 * 6/(6+2) + 0.35 * 1 = 84%`. The candidates' *other* seeded
 * reactions are removed rather than flipped to dislikes — a negative opinion
 * cancels the tag on the demo's otherwise identical vector and sinks the
 * cosine below the bar. Everybody else's likes are flipped to dislikes so the
 * only pairs with shared positive evidence are the two built here, and the
 * grid is exactly those two cards.
 */
async function makeStrongTaste() {
  const posts = await mockDb.allPosts();
  const shared = posts.slice(0, 6);
  const sharedIds = new Set(shared.map((post) => post.id));

  const everyone = await mockDb.allUsers();
  const demo = everyone.find((user) => user.id === 'user_demo')!;
  const targets = everyone
    .filter((user) => user.id !== 'user_demo' && mutualGate(demo, user).eligible)
    .slice(0, 2);
  expect(targets.length).toBe(2);
  const targetIds = new Set(targets.map((user) => user.id));

  for (const reaction of await mockDb.allPostReactions()) {
    if (reaction.userId === 'user_demo') continue;
    if (targetIds.has(reaction.userId)) {
      if (!sharedIds.has(reaction.postId)) {
        await mockDb.removePostReaction(reaction.userId, reaction.postId);
      }
    } else {
      await mockDb.recordPostReaction(reaction.userId, reaction.postId, 'dislike');
    }
  }

  for (const target of targets) {
    for (const post of shared) {
      await mockDb.recordPostReaction(target.id, post.id, 'like');
      await mockDb.recordPostReaction('user_demo', post.id, 'like');
    }
  }

  usePhotoFeedStore.getState().reset();
}

beforeEach(async () => {
  cleanup();
  useFeedStore.getState().reset();
  usePhotoFeedStore.getState().reset();
  await signInDemo();
});

afterEach(cleanup);

describe('a brand new account with no likes', () => {
  it('gets an empty deck that says why, rather than a card ranked on nothing', async () => {
    renderLikes();

    // The deck refuses to rank on the twenty points of stated fact. The old
    // behaviour handed a fresh account an "11% match, not enough to go on" card,
    // which taught anybody who looked at it that the percentage meant nothing.
    await waitFor(() =>
      expect(screen.getByText('Nothing to rank your matches on yet')).toBeTruthy()
    );

    expect(screen.queryByTestId(/deck-card-/)).toBeNull();
    expect(screen.getByText('Go to the photos')).toBeTruthy();
  });

  it('offers no swipe buttons, because there is nobody to decide about', async () => {
    renderLikes();

    await waitFor(() =>
      expect(screen.getByText('Nothing to rank your matches on yet')).toBeTruthy()
    );

    expect(screen.queryByTestId('swipe-like')).toBeNull();
  });

  it('says "no strong matches yet" when people are eligible but below the bar', async () => {
    // One like with nothing co-liked: the eligibility gates pass, but the photo
    // score is nowhere near 80%+, and a card admitting it has no number yet is
    // worse than an empty deck that explains the bar.
    const posts = await mockDb.allPosts();
    await mockDb.recordPostReaction('user_demo', posts[0]!.id, 'like');
    usePhotoFeedStore.getState().reset();

    renderLikes();

    await waitFor(() =>
      expect(screen.getByText('No strong matches yet')).toBeTruthy()
    );
    expect(screen.queryByTestId(/deck-card-/)).toBeNull();
    expect(screen.getByText('Go to the photos')).toBeTruthy();
  });
});

describe('an account with taste', () => {
  it('shows the whole pool at once, with the percentage on each card', async () => {
    await makeStrongTaste();
    renderLikes();

    const tiles = await waitFor(() => screen.getAllByTestId(/^deck-card-/));

    // One card at a time hid the shape of the pool. A grid shows everybody the
    // matcher is offering, so the choice is visibly a choice.
    expect(tiles.length).toBeGreaterThan(1);
    // The deck's own number, so there is one meaning for the word "match".
    expect(screen.getAllByText(/\d+%/).length).toBe(tiles.length);
  });

  it('decides on one person at a time, chosen by the person deciding', async () => {
    await makeStrongTaste();
    renderLikes();

    const tiles = await waitFor(() => screen.getAllByTestId(/^deck-card-/));
    fireEvent.press(tiles[tiles.length - 1]!);

    // The decision is full screen with the actions under it. It still happens on
    // one person at a time, because looking properly before deciding is the one
    // thing the old stack got right.
    await waitFor(() => expect(screen.getByTestId('likes-decision')).toBeTruthy());
    expect(screen.getByTestId('swipe-like')).toBeTruthy();
  });

  it('likes the person who was tapped, and not whoever happens to be first', async () => {
    await makeStrongTaste();
    renderLikes();

    const tiles = await waitFor(() => screen.getAllByTestId(/^deck-card-/));
    const target = tiles[tiles.length - 1]!;
    const targetId = target.props.testID.replace('deck-card-', '');

    fireEvent.press(target);
    await waitFor(() => expect(screen.getByTestId('likes-decision')).toBeTruthy());
    fireEvent.press(screen.getByTestId('swipe-like'));

    // The modal closes and the person leaves the grid. Anybody else staying put
    // is the point: deciding on one person must not reorder the rest of the pool
    // out from under them.
    await waitFor(() =>
      expect(screen.queryByTestId(`deck-card-${targetId}`)).toBeNull()
    );
    expect(screen.queryByTestId('likes-decision')).toBeNull();
    expect(screen.getAllByTestId(/^deck-card-/).length).toBe(tiles.length - 1);
  });

  it('takes back out of a decision without deciding anything', async () => {
    await makeStrongTaste();
    renderLikes();

    const tiles = await waitFor(() => screen.getAllByTestId(/^deck-card-/));
    fireEvent.press(tiles[0]!);

    await waitFor(() => expect(screen.getByTestId('likes-decision')).toBeTruthy());
    fireEvent.press(screen.getByTestId('likes-decision-close'));

    await waitFor(() => expect(screen.queryByTestId('likes-decision')).toBeNull());
    expect(screen.getAllByTestId(/^deck-card-/).length).toBe(tiles.length);
  });

  it('keeps the building-up strip alongside a deck, not on an empty one', async () => {
    await makeStrongTaste();
    renderLikes();

    // Six likes is below PHOTOS_FOR_FULL_TASTE, so the score is provisional and
    // the strip says so while cards are on screen.
    await waitFor(() => expect(screen.getByTestId('likes-building-up')).toBeTruthy());
    expect(screen.getAllByTestId(/^deck-card-/).length).toBeGreaterThan(0);
  });
});