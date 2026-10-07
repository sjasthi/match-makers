import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { preferencesSchema } from '@match-makers/shared';

import { PreferencesScreen } from '@/screens/profile/PreferencesScreen';
import { defaultPreferences, describeDistance } from '@/components';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { DEMO_EMAIL, DEMO_PASSWORD, generateDemoUser } from '@/utils/mockData';
import { hasCoordinates } from '@/utils/distance';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@match-makers/shared';

jest.setTimeout(30_000);

const Stack = createNativeStackNavigator();

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null });
  await mockDb.reset();
});

/** Mounted inside a navigator because the screen navigates back on save. */
function renderScreen() {
  return render(
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Preferences" component={PreferencesScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

async function signInDemo() {
  const adapter = new MockAuthAdapter();
  await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  useAuthStore.setState({ state: 'authenticated', user: await adapter.getCurrentUser() });
  return adapter;
}

/** The stepper is only on screen while the nearby radius is in force. */
function radiusStepper() {
  return screen.queryByTestId('stepper-increase-within');
}

describe('Discovery preferences', () => {
  it('offers nearby and global, with nearby selected by default', async () => {
    await signInDemo();
    renderScreen();

    expect(screen.getByText('Nearby')).toBeTruthy();
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.getByText('Only people within 50 km of you.')).toBeTruthy();
  });

  it('hides the radius stepper while global is on', async () => {
    // Hidden rather than disabled: a greyed-out stepper still reads as a
    // setting that is in force.
    await signInDemo();
    renderScreen();

    expect(radiusStepper()).not.toBeNull();

    fireEvent.press(screen.getByText('Global'));

    await waitFor(() => expect(radiusStepper()).toBeNull());
    expect(
      screen.getByText('Everyone, wherever they are. Distance will not be used to filter.')
    ).toBeTruthy();
  });

  it('brings the radius back when switching to nearby again', async () => {
    await signInDemo();
    renderScreen();

    fireEvent.press(screen.getByText('Global'));
    await waitFor(() => expect(radiusStepper()).toBeNull());

    fireEvent.press(screen.getByText('Nearby'));
    // Restored rather than reset to the default, so the choice survives a
    // detour through global.
    await waitFor(() => expect(radiusStepper()).not.toBeNull());
    expect(screen.getByText('Only people within 50 km of you.')).toBeTruthy();
  });

  it('persists the choice to the profile', async () => {
    const adapter = await signInDemo();
    renderScreen();

    fireEvent.press(screen.getByText('Global'));
    await waitFor(() => expect(radiusStepper()).toBeNull());
    fireEvent.press(screen.getByText('Save'));

    await waitFor(async () => {
      const stored = await adapter.getCurrentUser();
      expect(stored?.preferences.distanceMode).toBe('global');
    });
  });

  it('keeps the radius when persisting global, so the round trip restores it', async () => {
    const adapter = await signInDemo();
    renderScreen();

    fireEvent.press(screen.getByTestId('stepper-increase-within'));
    fireEvent.press(screen.getByTestId('stepper-increase-within'));
    await waitFor(() => expect(screen.getByText('Only people within 70 km of you.')).toBeTruthy());

    fireEvent.press(screen.getByText('Global'));
    await waitFor(() => expect(radiusStepper()).toBeNull());
    fireEvent.press(screen.getByText('Save'));

    await waitFor(async () => {
      const stored = await adapter.getCurrentUser();
      expect(stored?.preferences).toMatchObject({ distanceMode: 'global', maxDistance: 70 });
    });
  });
});

describe('defaultPreferences', () => {
  it('starts nearby with a radius in force', () => {
    const defaults = defaultPreferences();
    expect(defaults.distanceMode).toBe('nearby');
    expect(defaults.maxDistance).toBeGreaterThan(0);
  });

  it('passes the preferences schema, so a new account is valid', () => {
    expect(preferencesSchema.safeParse(defaultPreferences()).success).toBe(true);
  });
});

describe('describeDistance', () => {
  it('names the two states rather than printing a number nobody can act on', () => {
    expect(describeDistance({ ...generateDemoUser().preferences, distanceMode: 'global' })).toBe(
      'Global'
    );
    expect(
      describeDistance({
        ...generateDemoUser().preferences,
        maxDistance: 75,
        distanceMode: 'nearby',
      })
    ).toBe('Within 75 km');
  });
});

describe('seeded accounts are reachable', () => {
  it('gives every seeded candidate coordinates the rules can use', async () => {
    await mockDb.reset();
    const candidates = (await mockDb.allUsers()).filter((user) => user.id !== 'user_demo');

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(hasCoordinates(candidate.location)).toBe(true);
      expect((candidate as User).preferences.distanceMode).toBe('global');
    }
  });
});
