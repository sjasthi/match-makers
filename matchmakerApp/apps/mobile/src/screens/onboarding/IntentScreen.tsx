import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RelationshipGoal, SexualOrientation } from '@match-makers/shared';
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
  { value: SexualOrientation.OTHER, label: 'Something else' },
  { value: SexualOrientation.PREFER_NOT_TO_SAY, label: 'Prefer not to say' },
];

const GOAL_OPTIONS: ReadonlyArray<ChipOption<RelationshipGoal>> = [
  { value: RelationshipGoal.LONG_TERM, label: 'Long term' },
  { value: RelationshipGoal.SHORT_TERM, label: 'Short term' },
  { value: RelationshipGoal.CASUAL, label: 'Casual' },
  { value: RelationshipGoal.FRIENDSHIP, label: 'Friendship' },
  { value: RelationshipGoal.NOT_SURE, label: 'Not sure yet' },
];

/**
 * FP3 "Intent": sexual orientation and relationship goal.
 *
 * These used to be asked on the basics step alongside the name and bio. They
 * deserve their own step because they are the answers the matching engine
 * leans on hardest, and because the goal is a single stored value, so the
 * multi-select chip group that used to sit here silently dropped every choice
 * but the first.
 */
export function IntentScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const user = useAuthStore((store) => store.user);
  const setUser = useAuthStore((store) => store.setUser);

  const [orientation, setOrientation] = useState<SexualOrientation | null>(
    user?.sexualOrientation ?? null
  );
  const [goal, setGoal] = useState<RelationshipGoal | null>(
    user && user.relationshipGoal !== RelationshipGoal.NOT_SURE ? user.relationshipGoal : null
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setError(null);
    if (!orientation) {
      setError('Pick a sexual orientation, or choose prefer not to say.');
      return;
    }
    if (!goal) {
      setError('Pick the relationship goal that fits best.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile({
        sexualOrientation: orientation,
        relationshipGoal: goal,
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
          What are you looking for?
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          These two answers carry the most weight when we work out who to show you.
        </Text>
      </View>

      <View style={styles.form}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <SelectChips
          label="Sexual orientation"
          options={ORIENTATION_OPTIONS}
          selected={orientation ? [orientation] : []}
          onToggle={(value) => setOrientation(value)}
          multiple={false}
          error={!orientation}
        />

        <SelectChips
          label="Relationship goal"
          options={GOAL_OPTIONS}
          selected={goal ? [goal] : []}
          onToggle={(value) => setGoal(value)}
          multiple={false}
          error={!goal}
          helperText="One answer. We compare it directly against everyone else's."
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
  form: { gap: SPACING.lg, paddingBottom: SPACING.xl },
});
