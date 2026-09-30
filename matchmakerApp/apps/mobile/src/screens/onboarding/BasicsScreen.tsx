import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  RelationshipGoal,
  SexualOrientation,
  bioSchema,
  nameSchema,
  dateOfBirthSchema,
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

const ORIENTATION_OPTIONS: ReadonlyArray<ChipOption<SexualOrientation>> = [
  { value: SexualOrientation.STRAIGHT, label: 'Straight' },
  { value: SexualOrientation.GAY, label: 'Gay' },
  { value: SexualOrientation.LESBIAN, label: 'Lesbian' },
  { value: SexualOrientation.BISEXUAL, label: 'Bisexual' },
  { value: SexualOrientation.PANSEXUAL, label: 'Pansexual' },
  { value: SexualOrientation.ASEXUAL, label: 'Asexual' },
  { value: SexualOrientation.QUEER, label: 'Queer' },
  { value: SexualOrientation.PREFER_NOT_TO_SAY, label: 'Prefer not to say' },
];

const GOAL_OPTIONS: ReadonlyArray<ChipOption<RelationshipGoal>> = [
  { value: RelationshipGoal.LONG_TERM, label: 'Long term' },
  { value: RelationshipGoal.SHORT_TERM, label: 'Short term' },
  { value: RelationshipGoal.CASUAL, label: 'Casual' },
  { value: RelationshipGoal.FRIENDSHIP, label: 'Friendship' },
  { value: RelationshipGoal.NOT_SURE, label: 'Not sure yet' },
];

const FIELD_PROPS = {
  mode: 'outlined' as const,
  style: { backgroundColor: COLORS.background },
};

export function BasicsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const user = useAuthStore((store) => store.user);
  const setUser = useAuthStore((store) => store.setUser);

  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth ?? '');
  const [orientation, setOrientation] = useState<SexualOrientation | null>(
    user?.sexualOrientation ?? null
  );
  const [goals, setGoals] = useState<RelationshipGoal[]>(
    user && user.relationshipGoal !== RelationshipGoal.NOT_SURE ? [user.relationshipGoal] : []
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleGoal = (value: RelationshipGoal) => {
    setGoals((current) =>
      current.includes(value) ? current.filter((goal) => goal !== value) : [...current, value]
    );
  };

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

    setSaving(true);
    try {
      const updated = await updateProfile({
        name: parsedName.data,
        bio: parsedBio.data,
        dateOfBirth: parsedDob.data,
        sexualOrientation: orientation ?? SexualOrientation.PREFER_NOT_TO_SAY,
        // The stored model keeps a single goal, so the first selection wins.
        relationshipGoal: goals[0] ?? user?.relationshipGoal ?? RelationshipGoal.NOT_SURE,
      });
      setUser(updated);
      navigation.navigate('Photos');
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

        <SelectChips
          label="Sexual orientation"
          options={ORIENTATION_OPTIONS}
          selected={orientation ? [orientation] : []}
          onToggle={(value) => setOrientation(value)}
          multiple={false}
        />

        <SelectChips
          label="What are you looking for?"
          options={GOAL_OPTIONS}
          selected={goals}
          onToggle={toggleGoal}
          helperText="Pick the one that fits best. It feeds your match score."
        />

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
