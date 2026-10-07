import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS } from '@/constants';
import { WelcomeScreen } from '@/screens/onboarding/WelcomeScreen';
import { BasicsScreen } from '@/screens/onboarding/BasicsScreen';
import { IntentScreen } from '@/screens/onboarding/IntentScreen';
import { PhotosScreen } from '@/screens/onboarding/PhotosScreen';
import { LocationScreen } from '@/screens/onboarding/LocationScreen';
import { OnboardingDoneScreen } from '@/screens/onboarding/OnboardingDoneScreen';
import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/**
 * Account creation, in order: Welcome, Basics, Intent, Photos, Location.
 *
 * Values, lifestyle and the prompts are no longer here. They are asked one
 * prompt at a time on the Prompts screen after signup, so account creation
 * stays short and the questionnaire can be answered at whatever pace someone
 * actually wants. Two prompts are all it takes to open the feed.
 *
 * The step numbers below are written out rather than derived, because React
 * Navigation will happily let the user jump backwards to any of these and a
 * computed index would then show "Step 4 of 6" on screen two.
 */
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
      <Stack.Screen name="Intent" component={IntentScreen} options={{ title: 'Step 2 of 4' }} />
      <Stack.Screen name="Photos" component={PhotosScreen} options={{ title: 'Step 3 of 4' }} />
      <Stack.Screen name="Location" component={LocationScreen} options={{ title: 'Step 4 of 4' }} />
      <Stack.Screen
        name="OnboardingDone"
        component={OnboardingDoneScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
