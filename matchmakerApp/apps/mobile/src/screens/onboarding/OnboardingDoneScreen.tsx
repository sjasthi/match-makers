import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, PrimaryButton, AppIcon } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, SPACING } from '@/constants';
import type { RootStackParamList } from '@/navigation/types';

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
