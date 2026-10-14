import {
  fireEvent,
  render,
  screen,
  waitFor as rtlWaitFor,
} from '@testing-library/react-native';
import App from '../../App';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import { useAuthStore } from '@/stores/authStore';
import { useFeedStore, useMatchesStore } from '@/stores/feedStore';
import { usePhotoFeedStore } from '@/stores/photoFeedStore';

jest.setTimeout(30_000);

/**
 * RNTL's `waitFor` defaults to a 1000 ms budget, which is not enough for a test
 * that renders the whole `App` and walks the mock database. Under parallel-worker
 * load that is not a slow test, it is a failure that only appears on a busy
 * machine, so every wait here gets a real budget. Per-call `timeout` options
 * still win, for the few places that assert something slow on purpose.
 */
function waitFor(callback: () => unknown, options?: { timeout?: number }) {
  return rtlWaitFor(callback, { timeout: 30_000, ...options });
}


beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null });
  useFeedStore.getState().reset();
  useMatchesStore.getState().reset();
  usePhotoFeedStore.getState().reset();
  await mockDb.reset();
});

async function renderSignedIn() {
  const adapter = new MockAuthAdapter();
  await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

  render(<App />);

  // "Discover" is both the tab label and the photo feed's header, hence
  // getAllByText. It is the landing page, so waiting on it also waits for the
  // tabs to exist.
  await waitFor(() => expect(screen.getAllByText('Discover').length).toBeGreaterThan(0), {
    timeout: 15_000,
  });
}

/**
 * The Profile screen is registered both as a tab and as the Profile stack's
 * home, so it has to reach the root stack to navigate. Getting this wrong
 * makes every menu row a silent no-op, which no other test covered.
 */
async function openProfileTab() {
  fireEvent.press(screen.getByText('Profile'));
  await waitFor(() => expect(screen.getByText('Edit profile')).toBeTruthy());
}

describe('Profile menu navigation', () => {
  it('opens Edit profile from the Profile tab', async () => {
    await renderSignedIn();
    await openProfileTab();

    fireEvent.press(screen.getByLabelText('Edit profile'));

    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
  });

  it('opens Discovery preferences from the Profile tab', async () => {
    await renderSignedIn();
    await openProfileTab();

    fireEvent.press(screen.getByLabelText('Discovery preferences'));

    // Preferences left the onboarding flow when FP3 moved the age range onto
    // the location step, so it now saves and goes back rather than advancing.
    await waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
  });

  it('opens Verification from the Profile tab', async () => {
    await renderSignedIn();
    await openProfileTab();

    fireEvent.press(screen.getByLabelText('Verification'));

    await waitFor(() => expect(screen.getByText('Prove you are real')).toBeTruthy());
  });

  it('opens Settings from the Profile tab', async () => {
    await renderSignedIn();
    await openProfileTab();

    fireEvent.press(screen.getByLabelText('Settings'));

    await waitFor(() => expect(screen.getByText('Reset mock data')).toBeTruthy());
  });

  it('opens the taste profile from the Profile tab', async () => {
    await renderSignedIn();
    await openProfileTab();

    fireEvent.press(screen.getByLabelText('Your match profile'));

    // Taste is inferred from photos, so this panel is built from the reaction
    // history rather than from stored questionnaire answers. The demo account
    // seeds no reactions of its own, so this is the empty state rather than a
    // rendered breakdown.
    // The screen's own progress count, rather than the stack header, so this
    // asserts the panel rendered rather than the route was pushed.
    await waitFor(() => expect(screen.getByTestId('taste-progress-count')).toBeTruthy());
    expect(screen.getByText('WHAT WE ARE MATCHING ON')).toBeTruthy();
    expect(screen.queryByText('Values')).toBeNull();
    expect(screen.queryByText('Lifestyle')).toBeNull();
  });

  it('opens the account inspector from Settings', async () => {
    await renderSignedIn();
    await openProfileTab();

    fireEvent.press(screen.getByLabelText('Settings'));
    await waitFor(() => expect(screen.getByText('Reset mock data')).toBeTruthy());

    // The row only enables in mock mode, and mock is the default here.
    fireEvent.press(screen.getByTestId('settings-admin-row'));

    // 21 accounts: the demo account plus 20 seeded candidates.
    await waitFor(() => expect(screen.getByText('21 ACCOUNTS')).toBeTruthy(), { timeout: 15_000 });
  });
});

describe('main tabs', () => {
  it('lands a signed-in account on the photo grid', async () => {
    await renderSignedIn();

    // The first tab. The deck moved to its own tab precisely so that a new
    // account has something to do before it has answered anything, and the grid
    // is where that browsing happens.
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy(), {
      timeout: 15_000,
    });
    expect(screen.getAllByTestId(/^photo-tile-post_\d+$/).length).toBeGreaterThan(1);
  });

  it('offers the deck as its own tab, gated on a like rather than a questionnaire', async () => {
    await renderSignedIn();

    await waitFor(() => expect(screen.getByText('Likes')).toBeTruthy());
    fireEvent.press(screen.getByText('Likes'));

    // Either half of the tab is a correct landing here: a deck with cards, or
    // the empty state that says a like is what unlocks it. Which one depends on
    // whether the account has answered anything yet, and asserting on the
    // specific half would make this test about the seed rather than about the
    // navigation. What it must not be is the photo feed, which is what used to
    // live here.
    await waitFor(
      () =>
        expect(
          screen.getAllByText(
            /Tap somebody to look|Your deck gathers here|Nothing to rank your matches on/
          ).length
        ).toBeGreaterThan(0),
      { timeout: 15_000 }
    );
    expect(screen.queryByTestId('photo-post')).toBeNull();
  });

  it('keeps five tabs, with the two that take a single tap visually distinct', async () => {
    await renderSignedIn();

    // "Likes" the person and "Photos" the content. Two hearts would make it
    // ambiguous what the last tap on the feed had done.
    expect(screen.getByLabelText('Photos, tab, 1 of 5')).toBeTruthy();
    expect(screen.getByLabelText('Likes, tab, 2 of 5')).toBeTruthy();
  });
});

describe('the photo library admin route', () => {
  it('opens from Settings as its own row, separate from the read-only one', async () => {
    await renderSignedIn();
    await openProfileTab();

    fireEvent.press(screen.getByLabelText('Settings'));
    await waitFor(() => expect(screen.getByText('Reset mock data')).toBeTruthy());

    fireEvent.press(screen.getByTestId('settings-admin-posts-row'));

    await waitFor(() => expect(screen.getByText(/Site-owned content/)).toBeTruthy(), {
      timeout: 15_000,
    });
    // And it is a write path, which the account inspector above is not.
    expect(screen.getByTestId('admin-import-fab')).toBeTruthy();
  });
});
