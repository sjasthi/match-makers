import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import { useAuthStore } from '@/stores/authStore';
import { useFeedStore, useMatchesStore } from '@/stores/feedStore';

jest.setTimeout(30_000);

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null });
  useFeedStore.getState().reset();
  useMatchesStore.getState().reset();
  await mockDb.reset();
});

async function renderSignedIn() {
  const adapter = new MockAuthAdapter();
  await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

  render(<App />);

  // "Discover" is both the tab label and the feed header, hence getAllByText.
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

  it('opens Match profile from the Profile tab', async () => {
    await renderSignedIn();
    await openProfileTab();

    fireEvent.press(screen.getByLabelText('Match profile'));

    // The demo account ships a complete questionnaire, so this renders the
    // stored answers rather than the empty state.
    await waitFor(() => expect(screen.getByText('Your match profile')).toBeTruthy());
    expect(screen.getByText('Values')).toBeTruthy();
    expect(screen.getByText('Lifestyle')).toBeTruthy();
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
