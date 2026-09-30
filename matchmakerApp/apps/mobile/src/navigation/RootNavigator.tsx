import { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoadingState } from '@/components';
import { COLORS } from '@/constants';
import { useSession } from '@/hooks';
import { useAuthStore } from '@/stores/authStore';
import { useFeedStore, useMatchesStore } from '@/stores/feedStore';
import { AuthNavigator } from './AuthNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';
import { MainTabs } from './MainTabs';
import { ProfileNavigator } from './ProfileNavigator';
import { ChatNavigator } from './ChatNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { state } = useSession();
  const bootstrap = useAuthStore((store) => store.bootstrap);
  const resetFeed = useFeedStore((store) => store.reset);
  const resetMatches = useMatchesStore((store) => store.reset);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Signing out must not leave another person's feed in memory.
  useEffect(() => {
    if (state === 'anonymous') {
      resetFeed();
      resetMatches();
    }
  }, [state, resetFeed, resetMatches]);

  if (state === 'unknown') {
    return <LoadingState label="Starting up..." fullHeight />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.background },
        headerTintColor: COLORS.text,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    >
      {state === 'anonymous' ? (
        <Stack.Screen name="Auth" component={AuthNavigator} options={{ headerShown: false }} />
      ) : null}

      {state === 'needs_onboarding' ? (
        <Stack.Screen
          name="Onboarding"
          component={OnboardingNavigator}
          options={{ headerShown: false }}
        />
      ) : null}

      {state === 'authenticated' ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen
            name="Profile"
            component={ProfileNavigator}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen name="Chat" component={ChatNavigator} options={{ presentation: 'card' }} />
        </>
      ) : null}
    </Stack.Navigator>
  );
}
