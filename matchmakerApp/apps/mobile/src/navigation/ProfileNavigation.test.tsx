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

    // PreferencesScreen is reused from onboarding; the profile stack supplies
    // onComplete so the button saves and returns instead of advancing.
    await waitFor(() => expect(screen.getByText('Continue')).toBeTruthy());
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
});
