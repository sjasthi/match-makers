import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import {
  Gender,
  RelationshipGoal,
  type DistanceMode,
  type UserPreferences,
} from '@match-makers/shared';

import { SelectChips, Stepper, type ChipOption } from '@/components';
import { APP_CONFIG, SPACING } from '@/constants';

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

const DISTANCE_OPTIONS: ReadonlyArray<ChipOption<DistanceMode>> = [
  { value: 'nearby', label: 'Nearby' },
  { value: 'global', label: 'Global' },
];

const AGE_STEP = 5;
const DISTANCE_STEP = 10;
const MIN_DISTANCE = 5;

export function defaultPreferences(): UserPreferences {
  return {
    ageRange: { min: APP_CONFIG.MIN_AGE, max: 35 },
    distanceMode: 'nearby',
    maxDistance: 50,
    genders: [Gender.FEMALE, Gender.MALE, Gender.NON_BINARY],
    relationshipGoals: [RelationshipGoal.LONG_TERM],
  };
}

function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

interface Props {
  preferences: UserPreferences;
  onChange: (preferences: UserPreferences) => void;
  /** Wording for the gender and goal groups, which differ between the two screens. */
  goalHelperText?: string;
}

/**
 * "Who should we show you?" -- the whole discovery filter, in one place.
 *
 * This was written twice, once on the onboarding location step and once on the
 * profile preferences screen, with near-identical chip options, age and distance
 * steppers and toggle helpers in each copy. Two copies of a filter that decides
 * who a person is allowed to see is not a style problem: the copy that shipped
 * behind is the copy nobody tested. So the rules live here and both screens
 * render them.
 */
export function DiscoveryPreferences({ preferences, onChange, goalHelperText }: Props) {
  const isGlobal = preferences.distanceMode === 'global';

  const adjustAge = (key: 'min' | 'max', delta: number) => {
    const next = preferences.ageRange[key] + delta * AGE_STEP;
    if (next < APP_CONFIG.MIN_AGE || next > APP_CONFIG.MAX_AGE) return;

    const ageRange = { ...preferences.ageRange, [key]: next };
    // Keep the range coherent rather than letting min cross over max.
    if (ageRange.min >= ageRange.max) return;
    onChange({ ...preferences, ageRange });
  };

  const adjustDistance = (delta: number) => {
    const maxDistance = Math.min(
      APP_CONFIG.MAX_DISTANCE,
      Math.max(MIN_DISTANCE, preferences.maxDistance + delta * DISTANCE_STEP)
    );
    onChange({ ...preferences, maxDistance });
  };

  const setDistanceMode = (mode: DistanceMode) => {
    // Switching to global keeps the radius rather than clearing it, so coming
    // back to nearby restores whatever the person had chosen rather than the
    // default. It is also what lets `maxDistance` stay a plain number that the
    // schema can validate without having to allow nulls.
    if (mode === preferences.distanceMode) return;
    onChange({ ...preferences, distanceMode: mode });
  };

  return (
    <View style={styles.container}>
      <SelectChips
        label="How far"
        options={DISTANCE_OPTIONS}
        selected={[preferences.distanceMode]}
        onToggle={setDistanceMode}
        multiple={false}
        helperText={
          isGlobal
            ? 'Everyone, wherever they are. Distance will not be used to filter.'
            : `Only people within ${preferences.maxDistance} km of you.`
        }
        testID="distance-mode"
      />

      {/* Hidden rather than disabled while global: a greyed-out stepper still
          reads as a setting that is in force. */}
      {isGlobal ? null : (
        <View style={styles.block}>
          <Text variant="labelLarge">Maximum distance</Text>
          <Stepper
            label="Within"
            value={`${preferences.maxDistance} km`}
            onDecrease={() => adjustDistance(-1)}
            onIncrease={() => adjustDistance(1)}
          />
        </View>
      )}

      <View style={styles.block}>
        <Text variant="labelLarge">Age range</Text>
        <View style={styles.row}>
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

      <SelectChips
        label="Show me"
        options={GENDER_OPTIONS}
        selected={preferences.genders}
        onToggle={(value) =>
          onChange({ ...preferences, genders: toggleIn(preferences.genders, value) })
        }
      />

      <SelectChips
        label="Looking for"
        options={GOAL_OPTIONS}
        selected={preferences.relationshipGoals}
        onToggle={(value) =>
          onChange({
            ...preferences,
            relationshipGoals: toggleIn(preferences.relationshipGoals, value),
          })
        }
        helperText={goalHelperText ?? 'Used by the matching engine to score profiles.'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.lg },
  block: { gap: SPACING.sm },
  row: { flexDirection: 'row', gap: SPACING.md },
});

/** A short label for a preference set, for read-only surfaces. */
export function describeDistance(preferences: UserPreferences): string {
  return preferences.distanceMode === 'global' ? 'Global' : `Within ${preferences.maxDistance} km`;
}
