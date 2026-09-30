import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Photo } from '@match-makers/shared';
import { ScreenContainer, PrimaryButton, ErrorBanner, PhotoManager } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { COLORS, SPACING } from '@/constants';
import type { OnboardingStackParamList } from '@/navigation/types';

export function PhotosScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const user = useAuthStore((store) => store.user);
  const setUser = useAuthStore((store) => store.setUser);

  const [photos, setPhotos] = useState<Photo[]>(user?.photos ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Every step is seeded from the same record, so a null user only happens
  // if the session is torn down mid-flow. PhotoManager only needs an id and a
  // name, so a lightweight stand-in is enough to keep rendering.
  const subject = { id: user?.id ?? 'draft', name: user?.name ?? 'Your profile' };

  const onSave = async () => {
    setError(null);
    if (photos.length === 0) {
      setError('Add at least one photo so people recognise you.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile({ photos });
      setUser(updated);
      navigation.navigate('Preferences');
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
          Add photos
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          This is what people see first.
        </Text>
      </View>

      <View style={styles.form}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <PhotoManager user={subject} photos={photos} onChange={setPhotos} />

        <PrimaryButton onPress={onSave} loading={saving} disabled={saving} fullWidth>
          Continue
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
