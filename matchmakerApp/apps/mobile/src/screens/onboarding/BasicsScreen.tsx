import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Gender,
  bioSchema,
  nameSchema,
  dateOfBirthSchema,
  genderSchema,
} from '@match-makers/shared';
import {
  ScreenContainer,
  PrimaryButton,
  ErrorBanner,
  SelectChips,
  type ChipOption,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { COLORS, SPACING } from '@/constants';
import type { OnboardingStackParamList } from '@/navigation/types';

const GENDER_OPTIONS: ReadonlyArray<ChipOption<Gender>> = [
  { value: Gender.FEMALE, label: 'Woman' },
  { value: Gender.MALE, label: 'Man' },
  { value: Gender.NON_BINARY, label: 'Non-binary' },
  { value: Gender.PREFER_NOT_TO_SAY, label: 'Prefer not to say' },
];

const FIELD_PROPS = {
  mode: 'outlined' as const,
  style: { backgroundColor: COLORS.background },
};

/**
 * FP3 "Basics": name, date of birth, gender and a short bio.
 *
 * Gender is new here. Register already captures it, but a registered account
 * could still reach onboarding without it, and gender is read directly by the
 * matching engine when deciding who to show.
 */
export function BasicsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const user = useAuthStore((store) => store.user);
  const setUser = useAuthStore((store) => store.setUser);

  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth ?? '');
  const [gender, setGender] = useState<Gender | null>(user?.gender ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setError(null);

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

    const parsedGender = genderSchema.safeParse(gender);
    if (!parsedGender.success) {
      setError('Pick a gender, or choose prefer not to say.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile({
        name: parsedName.data,
        bio: parsedBio.data,
        dateOfBirth: parsedDob.data,
        gender: parsedGender.data,
      });
      setUser(updated);
      navigation.navigate('Intent');
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
          About you
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          This is what other people see first.
        </Text>
      </View>

      <View style={styles.form}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <TextInput
          {...FIELD_PROPS}
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          maxLength={50}
        />

        <TextInput
          {...FIELD_PROPS}
          label="Date of birth"
          placeholder="YYYY-MM-DD"
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
        />

        <SelectChips
          label="Gender"
          options={GENDER_OPTIONS}
          selected={gender ? [gender] : []}
          onToggle={(value) => setGender(value)}
          multiple={false}
          error={!gender}
          helperText="Used to decide who you are shown."
        />

        <TextInput
          {...FIELD_PROPS}
          label="Bio"
          placeholder="What are you into?"
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={4}
          maxLength={500}
          style={[styles.bio, { backgroundColor: COLORS.background }]}
        />
        <Text variant="bodySmall" style={styles.counter}>
          {bio.length}/500
        </Text>

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
  form: { gap: SPACING.md, paddingBottom: SPACING.xl },
  bio: { minHeight: 96 },
  counter: { color: COLORS.textSecondary, textAlign: 'right', marginTop: -SPACING.sm },
});
