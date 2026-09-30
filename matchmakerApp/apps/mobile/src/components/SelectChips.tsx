import { StyleSheet, View } from 'react-native';
import { Chip, Text } from 'react-native-paper';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  options: ReadonlyArray<ChipOption<T>>;
  selected: readonly T[];
  onToggle: (value: T) => void;
  error?: boolean;
  helperText?: string;
  multiple?: boolean;
}

export function SelectChips<T extends string>({
  label,
  options,
  selected,
  onToggle,
  error,
  helperText,
  multiple = true,
}: Props<T>) {
  return (
    <View style={styles.container}>
      <Text variant="labelLarge" style={styles.label}>
        {label}
      </Text>

      <View style={styles.chipRow}>
        {options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <Chip
              key={option.value}
              selected={isSelected}
              onPress={() => onToggle(option.value)}
              showSelectedCheck={multiple}
              style={[styles.chip, isSelected && styles.selectedChip]}
              textStyle={[styles.chipText, isSelected && styles.selectedChipText]}
              accessibilityState={{ selected: isSelected }}
            >
              {option.label}
            </Chip>
          );
        })}
      </View>

      {helperText || error ? (
        <Text variant="bodySmall" style={[styles.helper, error && styles.helperError]}>
          {error ? 'This field is required' : helperText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  label: {
    color: COLORS.text,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedChip: {
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  selectedChipText: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  helper: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
  },
  helperError: {
    color: COLORS.error,
  },
});
