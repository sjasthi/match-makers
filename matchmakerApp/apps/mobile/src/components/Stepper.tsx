import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';

interface StepperProps {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  /** Hides the value caption when the caption is redundant with the label. */
  hideLabel?: boolean;
  /**
   * Makes the value an editable field instead of static text.
   *
   * The stepper still owns the buttons; the caller owns what a legal value is.
   * Nothing is filtered here, because a control that silently rewrites what was
   * typed is a control that lies about what it did.
   */
  onChangeText?: (text: string) => void;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  /** Overrides the screen-reader label for the editable value. */
  inputAccessibilityLabel?: string;
}

/**
 * Numeric +/- control. Lives in components/ because both the onboarding
 * location step and the profile preferences screen adjust the age range and
 * distance, and two copies of this logic would drift.
 *
 * The value can be a plain caption or, when `onChangeText` is given, a field the
 * person types into. Both are the same control: nudging with the buttons and
 * typing the number are two ways of saying the same thing, so both are always
 * available rather than one being a mode you have to switch into.
 */
export function Stepper({
  label,
  value,
  onDecrease,
  onIncrease,
  hideLabel,
  onChangeText,
  onBlur,
  onSubmitEditing,
  inputAccessibilityLabel,
}: StepperProps) {
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
        {onChangeText ? (
          <TextInput
            mode="outlined"
            dense
            value={value}
            onChangeText={onChangeText}
            onBlur={onBlur}
            onSubmitEditing={onSubmitEditing}
            keyboardType="number-pad"
            returnKeyType="done"
            // Selecting on focus means typing replaces the number rather than
            // appending to it, which is what somebody who wants "25" out of
            // "18" expects.
            selectTextOnFocus
            outlineColor={COLORS.border}
            style={styles.input}
            contentStyle={styles.inputContent}
            accessibilityLabel={inputAccessibilityLabel ?? `${label} value`}
            testID={`stepper-input-${label.toLowerCase().replace(/\s+/g, '-')}`}
          />
        ) : (
          <Text variant="titleMedium" style={styles.stepperValue}>
            {value}
          </Text>
        )}
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
  input: {
    width: 72,
    height: 40,
    backgroundColor: COLORS.background,
  },
  inputContent: {
    textAlign: 'center',
    fontWeight: '700',
    fontSize: FONT_SIZES.md,
  },
});
