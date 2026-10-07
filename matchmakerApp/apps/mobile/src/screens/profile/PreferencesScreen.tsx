import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { UserPreferences } from '@match-makers/shared';
import {
  ScreenContainer,
  PrimaryButton,
  ErrorBanner,
  DiscoveryPreferences,
  defaultPreferences,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { COLORS, SPACING } from '@/constants';
import type { ProfileStackParamList } from '@/navigation/types';

/**
 * Discovery preferences, edited after onboarding.
 *
 * This was the onboarding preferences step until FP3 moved the age range and
 * distance onto the location step, leaving only "who should we show you". It is
 * still worth a home here, because changing your mind later is normal and
 * making it an onboarding-only answer would mean re-running the questionnaire.
 *
 * The filters themselves are `DiscoveryPreferences`, shared with that onboarding
 * step so the two cannot drift into disagreeing about who gets shown.
 */
export function PreferencesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const user = useAuthStore((store) => store.user);
  const setUser = useAuthStore((store) => store.setUser);

  const [preferences, setPreferences] = useState<UserPreferences>(
    user?.preferences ?? defaultPreferences()
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setError(null);

    if (preferences.genders.length === 0) {
      setError('Pick at least one group to see.');
      return;
    }
    if (preferences.relationshipGoals.length === 0) {
      setError('Pick at least one relationship goal.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile({ preferences });
      setUser(updated);
      navigation.goBack();
    } catch (caught) {
      setError(AuthError.unknown(caught).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>
          Who should we show you?
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          You can change any of this at any time.
        </Text>
      </View>

      <View style={styles.form}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <DiscoveryPreferences preferences={preferences} onChange={setPreferences} />

        <PrimaryButton onPress={onSave} loading={saving} disabled={saving} fullWidth>
          Save
        </PrimaryButton>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: SPACING.xs, marginBottom: SPACING.lg },
  title: { fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary },
  form: { gap: SPACING.lg, paddingBottom: SPACING.xl },
});
