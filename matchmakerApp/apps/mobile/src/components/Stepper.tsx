import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';

interface StepperProps {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  /** Hides the value caption when the caption is redundant with the label. */
  hideLabel?: boolean;
}

/**
 * Numeric +/- control. Lives in components/ because both the onboarding
 * location step and the profile preferences screen adjust the age range and
 * distance, and two copies of this logic would drift.
 */
export function Stepper({ label, value, onDecrease, onIncrease, hideLabel }: StepperProps) {
  return (
    <View style={styles.stepper}>
      {hideLabel ? null : (
        <Text variant="bodySmall" style={styles.stepperLabel}>
          {label}
        </Text>
      )}
      <View style={styles.stepperControls}>
        <Text
          style={styles.stepperButton}
          onPress={onDecrease}
          suppressHighlighting
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          testID={`stepper-decrease-${label.toLowerCase().replace(/\s+/g, '-')}`}
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
          testID={`stepper-increase-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          +
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
