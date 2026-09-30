import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { bioSchema, dateOfBirthSchema, nameSchema, type Photo } from '@match-makers/shared';
import { ScreenContainer, PrimaryButton, ErrorBanner, PhotoManager } from '@/components';
import { useCurrentUser } from '@/hooks';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { COLORS, SPACING } from '@/constants';
import type { RootStackParamList } from '@/navigation/types';

const FIELD_STYLE = { backgroundColor: COLORS.background };

export function EditProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const user = useCurrentUser();
  const setUser = useAuthStore((store) => store.setUser);

  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth ?? '');
  const [city, setCity] = useState(user?.location.city ?? '');
  const [country, setCountry] = useState(user?.location.country ?? '');
  const [photos, setPhotos] = useState<Photo[]>(user?.photos ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setError(null);

    if (photos.length === 0) {
      setError('Add at least one photo so people recognise you.');
      return;
    }

    const parsedName = nameSchema.safeParse(name);
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? 'Check your name');
      return;
    }
    const parsedBio = bioSchema.safeParse(bio);
    if (!parsedBio.success) {
      setError(parsedBio.error.issues[0]?.message ?? 'Check your bio');
      return;
    }
    const parsedDob = dateOfBirthSchema.safeParse(dateOfBirth);
    if (!parsedDob.success) {
      setError(parsedDob.error.issues[0]?.message ?? 'Check your date of birth');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile({
        name: parsedName.data,
        bio: parsedBio.data,
        dateOfBirth: parsedDob.data,
        photos,
        location: {
          ...user?.location,
          latitude: user?.location.latitude ?? 0,
          longitude: user?.location.longitude ?? 0,
          city: city.trim(),
          country: country.trim(),
        },
      });
      setUser(updated);
      navigation.goBack();
    } catch (caught) {
      setError(AuthError.unknown(caught).message);
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return <ScreenContainer />;
  }

  return (
    <ScreenContainer scroll>
      <View style={styles.form}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <PhotoManager user={user} photos={photos} onChange={setPhotos} />

        <TextInput
          mode="outlined"
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          style={FIELD_STYLE}
        />

        <TextInput
          mode="outlined"
          label="Bio"
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={5}
          maxLength={500}
          style={[styles.bio, FIELD_STYLE]}
        />
        <Text variant="bodySmall" style={styles.counter}>
          {bio.length}/500
        </Text>

        <TextInput
          mode="outlined"
          label="Date of birth"
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          style={FIELD_STYLE}
        />

        <TextInput
          mode="outlined"
          label="City"
          value={city}
          onChangeText={setCity}
          autoCapitalize="words"
          style={FIELD_STYLE}
        />

        <TextInput
          mode="outlined"
          label="Country"
          value={country}
          onChangeText={setCountry}
          autoCapitalize="words"
          style={FIELD_STYLE}
        />

        <PrimaryButton onPress={onSave} loading={saving} disabled={saving} fullWidth>
          Save changes
        </PrimaryButton>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  form: { gap: SPACING.md, paddingVertical: SPACING.lg, paddingBottom: SPACING.xxl },
  bio: { minHeight: 120 },
  counter: { color: COLORS.textSecondary, textAlign: 'right', marginTop: -SPACING.sm },
});
