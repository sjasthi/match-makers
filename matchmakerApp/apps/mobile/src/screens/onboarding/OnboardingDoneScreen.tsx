import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, PrimaryButton, AppIcon } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { getMissingProfileSections, isProfileComplete } from '@/services/profile';
import { firstIncompleteStep } from '@/navigation/onboardingSteps';
import { COLORS, SPACING } from '@/constants';
import type { RootStackParamList } from '@/navigation/types';

/** Readable names for the gaps the profile can still have. */
const SECTION_LABELS: Record<string, string> = {
  bio: 'a bio',
  photos: 'a photo',
  location: 'your location',
  preferences: 'who you want to see',
};

export function OnboardingDoneScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const user = useAuthStore((store) => store.user);
  const refreshUser = useAuthStore((store) => store.refreshUser);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    void refreshUser()
      .catch(() => undefined)
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [refreshUser]);

  // RootNavigator only registers the Main stack once the profile is complete,
  // so replacing to it from an incomplete state throws a no-route error and the
  // button silently does nothing. Check first and send the user to the step
  // that is actually blocking them instead.
  const missing = getMissingProfileSections(user);
  const isComplete = checking ? false : isProfileComplete(user);
  const nextStep = firstIncompleteStep(missing);

  if (!checking && !isComplete) {
    const readable = [...new Set(missing.map((section) => SECTION_LABELS[section] ?? section))];

    return (
      <ScreenContainer>
        <View style={styles.content}>
          <AppIcon name="clipboard-alert-outline" size={56} color={COLORS.warning} />
          <Text variant="headlineMedium" style={styles.title}>
            Almost there
          </Text>
          <Text variant="bodyMedium" style={styles.body}>
            Your profile still needs {readable.join(' and ')}. Add{' '}
            {readable.length === 1 ? 'it' : 'them'} and you are ready to swipe.
          </Text>
        </View>

        <PrimaryButton
          onPress={() =>
            nextStep ? navigation.navigate('Onboarding', { screen: nextStep }) : undefined
          }
          disabled={!nextStep}
          fullWidth
        >
          Finish your profile
        </PrimaryButton>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.content}>
        <AppIcon name="check-decagram" size={64} color={COLORS.secondary} />
        <Text variant="headlineMedium" style={styles.title}>
          You are all set
        </Text>
        <Text variant="bodyMedium" style={styles.body}>
          {user?.name ? `${user.name.split(' ')[0]}, your` : 'Your'} profile is live. Go see who is
          in your area.
        </Text>
      </View>

      <PrimaryButton
        onPress={() => navigation.replace('Main', { screen: 'Feed' })}
        loading={checking}
        disabled={checking}
        fullWidth
      >
        Start swiping
      </PrimaryButton>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
  },
  title: { fontWeight: '800' },
  body: { color: COLORS.textSecondary, textAlign: 'center' },
});
