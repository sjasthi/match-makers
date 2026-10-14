import { cleanup, fireEvent, render, screen, waitFor as rtlWaitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute } from '@react-navigation/native';
import type { TasteSummary } from '@match-makers/shared';

import { TasteProfileScreen } from '@/screens/profile/TasteProfileScreen';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import type { ProfileStackParamList } from '@/navigation/types';

jest.setTimeout(60_000);

const Stack = createNativeStackNavigator<ProfileStackParamList>();

jest.mock('@/services/posts', () => ({
  fetchTasteSummary: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fetchTasteSummary } = jest.requireMock('@/services/posts') as {
  fetchTasteSummary: jest.Mock;
};

function waitFor(callback: () => unknown, options?: { timeout?: number }) {
  return rtlWaitFor(callback, { timeout: 30_000, ...options });
}

/**
 * Stand-in for ProfileDetail that records what it was navigated to.
 *
 * Reads the real route rather than spying on `navigate`, so the assertion covers
 * the params that actually arrive rather than the ones the screen tried to send.
 */
let navigatedWith: unknown = null;

function Destination() {
  const route = useRoute();
  navigatedWith = route.params;
  return null;
}

function renderScreen(summary: TasteSummary) {
  fetchTasteSummary.mockResolvedValue(summary);
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="TasteProfile" component={TasteProfileScreen} />
        <Stack.Screen name="ProfileDetail" component={Destination} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const PERSON = {
  userId: 'user_0001',
  name: 'Priya Haddad',
  score: 58,
  affinity: 0.42,
  coLikedPosts: 5,
  sharedTags: ['animal', 'food'],
  reason: 'You both liked 5 of the same photos, tagged animal and food',
};

function summaryWith(closest: TasteSummary['closest'], blocked = false): TasteSummary {
  return {
    likes: 8,
    dislikes: 1,
    tags: [{ tag: 'animal', score: 0.6, likes: 5, dislikes: 0 }],
    closest,
    closestBlockedByFilters: blocked,
  };
}

beforeEach(async () => {
  navigatedWith = null;
  fetchTasteSummary.mockReset();
  await mockDb.reset();
  const adapter = new MockAuthAdapter();
  await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
});

afterEach(cleanup);

describe('the people your answers pulled you towards', () => {
  it('shows them as a grid with the percentage on each card', async () => {
    renderScreen(
      summaryWith([
        PERSON,
        { ...PERSON, userId: 'user_0002', name: 'Sinead Tanaka', score: 44 },
        { ...PERSON, userId: 'user_0003', name: 'Zara Diallo', score: 31 },
      ])
    );

    await waitFor(() => expect(screen.getByTestId('taste-match-user_0001')).toBeTruthy());

    expect(screen.getByText('Priya Haddad')).toBeTruthy();
    expect(screen.getByText('Sinead Tanaka')).toBeTruthy();
    // The deck's own number, so there is one meaning for the word "match".
    expect(screen.getByText('58%')).toBeTruthy();
  });

  it('does not imply a ranking the deck could contradict', async () => {
    renderScreen(
      summaryWith([
        { ...PERSON, userId: 'user_0002', name: 'Sinead Tanaka', score: 71, affinity: 0.2 },
        PERSON,
      ])
    );

    await waitFor(() => expect(screen.getByTestId('taste-match-user_0001')).toBeTruthy());

    // The person the deck would put first is listed second here on purpose. A
    // grid has no first place, so nothing on this screen can contradict the deck's
    // own ordering — which is exactly the confusion this panel used to cause.
    const tiles = screen.getAllByTestId(/^taste-match-/);
    expect(tiles.map((tile) => tile.props.testID)).toEqual([
      'taste-match-user_0002',
      'taste-match-user_0001',
    ]);
  });

  it('gives each card a reason a person can check', async () => {
    renderScreen(summaryWith([PERSON]));

    await waitFor(() => expect(screen.getByTestId('taste-match-user_0001')).toBeTruthy());

    expect(screen.getByText('You both liked 5 of the same photos, tagged animal and food')).toBeTruthy();
  });

  it('says who it is and why, for a screen reader', async () => {
    renderScreen(summaryWith([PERSON]));

    await waitFor(() => expect(screen.getByTestId('taste-match-user_0001')).toBeTruthy());

    const tile = screen.getByTestId('taste-match-user_0001');
    expect(tile.props.accessibilityLabel).toBe(
      `Priya Haddad, 58% match. ${PERSON.reason}`
    );
  });
});

describe('tapping somebody', () => {
  it('opens their profile carrying the signal they were chosen for', async () => {
    renderScreen(summaryWith([PERSON]));

    await waitFor(() => expect(screen.getByTestId('taste-match-user_0001')).toBeTruthy());
    fireEvent.press(screen.getByTestId('taste-match-user_0001'));

    // The detail screen re-derives its breakdown from this. With nothing, it would
    // tell somebody they share nothing with whoever just sent them there.
    await waitFor(() => expect(navigatedWith).not.toBeNull());
    expect(navigatedWith).toMatchObject({
      userId: 'user_0001',
      taste: {
        affinity: 0.42,
        coLikedPosts: 5,
        sharedTags: ['animal', 'food'],
      },
    });
  });
});

describe('when there is nobody', () => {
  it('blames the answers when there is simply nothing shared yet', async () => {
    renderScreen(summaryWith([]));

    await waitFor(() => expect(screen.getByText(/Nobody yet/)).toBeTruthy());
    expect(screen.queryByText(/outside your current discovery filters/)).toBeNull();
  });

  it('names the filters when that is the real reason', async () => {
    renderScreen(summaryWith([], true));

    await waitFor(() =>
      expect(screen.getByText(/outside your current discovery filters/)).toBeTruthy()
    );
    // Telling somebody to answer more photos when the answer is a setting they
    // can widen is the same mistake the deck's empty state was fixed for.
    expect(screen.queryByText(/Nobody yet/)).toBeNull();
  });
});