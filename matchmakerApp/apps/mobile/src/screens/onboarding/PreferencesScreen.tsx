import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gender, RelationshipGoal, type UserPreferences } from '@match-makers/shared';
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
import { APP_CONFIG, COLORS, FONT_SIZES, SPACING } from '@/constants';
import type { OnboardingStackParamList } from '@/navigation/types';

const GENDER_OPTIONS: ReadonlyArray<ChipOption<Gender>> = [
  { value: Gender.FEMALE, label: 'Women' },
  { value: Gender.MALE, label: 'Men' },
  { value: Gender.NON_BINARY, label: 'Non-binary people' },
];

const GOAL_OPTIONS: ReadonlyArray<ChipOption<RelationshipGoal>> = [
  { value: RelationshipGoal.LONG_TERM, label: 'Long term' },
  { value: RelationshipGoal.SHORT_TERM, label: 'Short term' },
  { value: RelationshipGoal.CASUAL, label: 'Casual' },
  { value: RelationshipGoal.FRIENDSHIP, label: 'Friendship' },
];

const AGE_STEP = 5;

interface PreferencesScreenProps {
  /**
   * Called instead of advancing through onboarding. Supplied when the screen is
   * reused from the profile stack, where `Location` is not a route.
   */
  onComplete?: () => void;
}

export function PreferencesScreen({ onComplete }: PreferencesScreenProps = {}) {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const user = useAuthStore((store) => store.user);
  const setUser = useAuthStore((store) => store.setUser);

  const [preferences, setPreferences] = useState<UserPreferences>(
    user?.preferences ?? {
      ageRange: { min: APP_CONFIG.MIN_AGE, max: 35 },
      maxDistance: 50,
      genders: [Gender.FEMALE, Gender.MALE, Gender.NON_BINARY],
      relationshipGoals: [RelationshipGoal.LONG_TERM],
    }
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleIn = <T,>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const adjustAge = (key: 'min' | 'max', delta: number) => {
    setPreferences((current) => {
      const next = current.ageRange[key] + delta * AGE_STEP;
      if (next < APP_CONFIG.MIN_AGE || next > APP_CONFIG.MAX_AGE) return current;
      const ageRange = { ...current.ageRange, [key]: next };
      // Keep the range coherent rather than letting min cross over max.
      if (ageRange.min >= ageRange.max) return current;
      return { ...current, ageRange };
    });
  };

  const adjustDistance = (delta: number) => {
    setPreferences((current) => {
      const maxDistance = Math.min(
        APP_CONFIG.MAX_DISTANCE,
        Math.max(5, current.maxDistance + delta * 10)
      );
      return { ...current, maxDistance };
    });
  };

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
      if (onComplete) {
        onComplete();
      } else {
        navigation.navigate('Location');
      }
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
          You can change any of this later in settings.
        </Text>
      </View>

      <View style={styles.form}>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <View style={styles.stepperBlock}>
          <Text variant="labelLarge">Age range</Text>
          <View style={styles.stepperRow}>
            <Stepper
              label="From"
              value={`${preferences.ageRange.min}`}
              onDecrease={() => adjustAge('min', -1)}
              onIncrease={() => adjustAge('min', 1)}
            />
            <Stepper
              label="To"
              value={`${preferences.ageRange.max}`}
              onDecrease={() => adjustAge('max', -1)}
              onIncrease={() => adjustAge('max', 1)}
            />
          </View>
        </View>

        <View style={styles.stepperBlock}>
          <Text variant="labelLarge">Maximum distance</Text>
          <Stepper
            label="Within"
            value={`${preferences.maxDistance} km`}
            onDecrease={() => adjustDistance(-1)}
            onIncrease={() => adjustDistance(1)}
          />
        </View>

        <SelectChips
          label="Show me"
          options={GENDER_OPTIONS}
          selected={preferences.genders}
          onToggle={(value) =>
            setPreferences((current) => ({
              ...current,
              genders: toggleIn(current.genders, value),
            }))
          }
        />

        <SelectChips
          label="Looking for"
          options={GOAL_OPTIONS}
          selected={preferences.relationshipGoals}
          onToggle={(value) =>
            setPreferences((current) => ({
              ...current,
              relationshipGoals: toggleIn(current.relationshipGoals, value),
            }))
          }
          helperText="Used by the matching engine to score profiles."
        />

        <PrimaryButton onPress={onSave} loading={saving} disabled={saving} fullWidth>
          Continue
        </PrimaryButton>
      </View>
    </ScreenContainer>
  );
}

interface StepperProps {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
}

function Stepper({ label, value, onDecrease, onIncrease }: StepperProps) {
  return (
    <View style={styles.stepper}>
      <Text variant="bodySmall" style={styles.stepperLabel}>
        {label}
      </Text>
      <View style={styles.stepperControls}>
        <Text
          style={styles.stepperButton}
          onPress={onDecrease}
          suppressHighlighting
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
        >
          −
        </Text>
        <Text variant="titleMedium" style={styles.stepperValue}>
          {value}
        </Text>
        <Text
          style={styles.stepperButton}
          onPress={onIncrease}
          suppressHighlighting
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
        >
          +
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: SPACING.xs, marginBottom: SPACING.lg },
  title: { fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary },
  form: { gap: SPACING.lg, paddingBottom: SPACING.xl },
  stepperBlock: { gap: SPACING.sm },
  stepperRow: { flexDirection: 'row', gap: SPACING.md },
  stepper: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: SPACING.md,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  stepperLabel: { color: COLORS.textSecondary },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperButton: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.primary,
    fontWeight: '700',
    paddingHorizontal: SPACING.md,
  },
  stepperValue: { fontWeight: '700' },
});
