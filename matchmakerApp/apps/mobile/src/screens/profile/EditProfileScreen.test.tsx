import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pressable, Text } from 'react-native';
import { RelationshipGoal } from '@match-makers/shared';

import { EditProfileScreen } from '@/screens/profile/EditProfileScreen';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import { useAuthStore } from '@/stores/authStore';

const Stack = createNativeStackNavigator();

function HomeScreen({ navigation }: { navigation: { navigate: (route: string) => void } }) {
  return (
    <Pressable onPress={() => navigation.navigate('EditProfile')}>
      <Text>Open editor</Text>
    </Pressable>
  );
}

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null });
  await mockDb.reset();
});

function renderScreen() {
  return render(
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Home">
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

describe('EditProfileScreen relationship goal', () => {
  it('lets a user change and save their profile goal, including from not sure', async () => {
    const adapter = new MockAuthAdapter();
    await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const current = await mockDb.findUserByEmail(DEMO_EMAIL);
    if (!current) throw new Error('Demo account was not loaded');

    const unsure = { ...current, relationshipGoal: RelationshipGoal.NOT_SURE };
    await mockDb.saveUser(unsure);
    useAuthStore.setState({ state: 'authenticated', user: unsure, error: null });

    renderScreen();
    fireEvent.press(screen.getByText('Open editor'));

    expect(screen.getByText('My relationship goal')).toBeTruthy();
    expect(screen.getByText('Not sure yet')).toBeTruthy();
    fireEvent.press(screen.getByText('Short term'));
    fireEvent.press(screen.getByText('Save changes'));

    await waitFor(async () => {
      expect((await adapter.getCurrentUser())?.relationshipGoal).toBe(RelationshipGoal.SHORT_TERM);
    });
  });
});
