import { render, screen, waitFor } from '@testing-library/react-native';
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

describe('App smoke test', () => {
  it('boots to the login screen when nobody is signed in', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Match Makers')).toBeTruthy();
    });
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('lands on the feed when a session already exists', async () => {
    const adapter = new MockAuthAdapter();
    await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

    render(<App />);

    // RootNavigator swaps stacks based on session state, then the feed loads.
    await waitFor(
      () => {
        expect(screen.getByText('Discover')).toBeTruthy();
      },
      { timeout: 15_000 }
    );
  });
});
