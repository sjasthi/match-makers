import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS } from '@/constants';
import { WelcomeScreen } from '@/screens/onboarding/WelcomeScreen';
import { BasicsScreen } from '@/screens/onboarding/BasicsScreen';
import { PhotosScreen } from '@/screens/onboarding/PhotosScreen';
import { PreferencesScreen } from '@/screens/onboarding/PreferencesScreen';
import { LocationScreen } from '@/screens/onboarding/LocationScreen';
import { OnboardingDoneScreen } from '@/screens/onboarding/OnboardingDoneScreen';
import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Welcome"
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.background },
        headerTitleStyle: { fontWeight: '700' },
        headerTintColor: COLORS.text,
        contentStyle: { backgroundColor: COLORS.background },
        headerBackTitleVisible: false,
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Basics" component={BasicsScreen} options={{ title: 'Step 1 of 4' }} />
      <Stack.Screen name="Photos" component={PhotosScreen} options={{ title: 'Step 2 of 4' }} />
      <Stack.Screen
        name="Preferences"
        component={PreferencesScreen}
        options={{ title: 'Step 3 of 4' }}
      />
      <Stack.Screen name="Location" component={LocationScreen} options={{ title: 'Step 4 of 4' }} />
      <Stack.Screen
        name="OnboardingDone"
        component={OnboardingDoneScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
