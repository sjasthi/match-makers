import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AdminUsersScreen } from '@/screens/admin/AdminUsersScreen';
import { AdminUserDetailScreen } from '@/screens/admin/AdminUserDetailScreen';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { setActiveAuthMode } from '@/services/auth';
import { useAuthStore } from '@/stores/authStore';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import type { ProfileStackParamList } from '@/navigation/types';

jest.setTimeout(60_000);

const Stack = createNativeStackNavigator<ProfileStackParamList>();

/**
 * The two admin screens in a bare navigator.
 *
 * Rendering the whole `App` and walking Profile -> Settings -> Developer would
 * test the same code with a lot more waiting, and the admin screens own their
 * own gating, so the stack is built here directly.
 */
function renderAdmin() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="AdminUsers" component={AdminUsersScreen} />
        <Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null, authMode: 'mock' });
  await mockDb.reset();
});

afterEach(async () => {
  cleanup();
  await setActiveAuthMode('mock');
});

describe('AdminUsersScreen', () => {
  it('lists every account in the mock database', async () => {
    renderAdmin();

    await waitFor(() => expect(screen.getByText('21 ACCOUNTS')).toBeTruthy());

    // Every seeded account has a row, not just the signed-in one.
    expect(screen.getByTestId('admin-user-row-user_demo')).toBeTruthy();
    expect(screen.getByText(DEMO_EMAIL)).toBeTruthy();
  });

  it('includes an account registered outside the session', async () => {
    await new MockAuthAdapter().register({
      email: 'test.subject@example.com',
      password: 'Str0ngPass',
      name: 'Test Subject',
      dateOfBirth: '1994-02-04',
      gender: 'female' as never,
    });

    renderAdmin();

    await waitFor(() => expect(screen.getByText('22 ACCOUNTS')).toBeTruthy());
    expect(screen.getByText('test.subject@example.com')).toBeTruthy();
    // The panel's job is to show what a half-finished signup actually stored.
    expect(screen.getByText('PROFILE INCOMPLETE')).toBeTruthy();
  });

  it('marks the demo account and the signed-in account', async () => {
    const adapter = new MockAuthAdapter();
    await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    useAuthStore.setState({ state: 'authenticated', user: await adapter.getCurrentUser() });

    renderAdmin();

    await waitFor(() => expect(screen.getByText('21 ACCOUNTS')).toBeTruthy());
    expect(screen.getByText('DEMO')).toBeTruthy();
    expect(screen.getByText('YOU')).toBeTruthy();
  });

  it('opens the record for a tapped account', async () => {
    renderAdmin();

    await waitFor(() => expect(screen.getByText('21 ACCOUNTS')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-user-row-user_demo'));

    // Detail reads the full record, not the trimmed profile view. Section
    // headings are uppercased, so match them as rendered.
    await waitFor(() => expect(screen.getByText('RECORD')).toBeTruthy());
    expect(screen.getByText('user_demo')).toBeTruthy();
    // Coordinates are shown as one usable/unusable verdict rather than two raw
    // numbers, because "0, 0" is a profile nobody in a nearby deck can see.
    expect(screen.getByText('coordinates')).toBeTruthy();
    expect(screen.getByText(/30\.2672, -97\.7431/)).toBeTruthy();
    expect(screen.getByText('distanceMode')).toBeTruthy();
    expect(screen.getByText('nearby')).toBeTruthy();
  });

  it('refuses to list anything outside mock mode', async () => {
    useAuthStore.setState({ authMode: 'jwt' });

    renderAdmin();

    await waitFor(() => expect(screen.getByText('Mock mode only')).toBeTruthy());
    expect(screen.queryByTestId('admin-users-list')).toBeNull();
  });
});
