import { StyleSheet, View } from 'react-native';
import { SegmentedButtons, Text } from 'react-native-paper';
import { ImportanceScale } from '@match-makers/shared';
import { MIN_IMPORTANCE, MAX_IMPORTANCE } from '@match-makers/shared';
import { COLORS, FONT_SIZES, SPACING } from '@/constants';

interface ImportanceScaleProps {
  /** Which value is being graded, used for the accessible button labels. */
  valueLabel: string;
  value: ImportanceScale | undefined;
  onChange: (value: ImportanceScale) => void;
}

function buildScale(): ImportanceScale[] {
  const scale: ImportanceScale[] = [];
  for (let level = MIN_IMPORTANCE; level <= MAX_IMPORTANCE; level += 1) {
    scale.push(level as ImportanceScale);
  }
  return scale;
}

const SCALE = buildScale();

const DESCRIPTIONS: Record<ImportanceScale, string> = {
  [ImportanceScale.NICE_TO_HAVE]: 'Nice to have',
  [ImportanceScale.FAIRLY_IMPORTANT]: 'Fairly important',
  [ImportanceScale.IMPORTANT]: 'Important',
  [ImportanceScale.VERY_IMPORTANT]: 'Very important',
  [ImportanceScale.NON_NEGOTIABLE]: 'Non-negotiable',
};

/**
 * Grades one partner value from 1 to 5.
 *
 * This is the weight the FP2 matching engine will eventually read, which is why
 * it is collected now and stored rather than inferred later. Nothing consumes
 * it yet: scoreCompatibility still uses its FP2 weights.
 */
export function ImportanceScaleControl({ valueLabel, value, onChange }: ImportanceScaleProps) {
  return (
    <View style={styles.container} testID={`importance-${valueLabel.toLowerCase()}`}>
      <View style={styles.header}>
        <Text variant="labelLarge" style={styles.label}>
          {valueLabel}
        </Text>
        {value ? (
          <Text variant="bodySmall" style={styles.description}>
            {DESCRIPTIONS[value]}
          </Text>
        ) : null}
      </View>
      <SegmentedButtons
        value={value === undefined ? '' : String(value)}
        onValueChange={(next) => {
          const level = Number(next) as ImportanceScale;
          if (level >= MIN_IMPORTANCE && level <= MAX_IMPORTANCE) onChange(level);
        }}
        density="small"
        buttons={SCALE.map((level) => ({
          value: String(level),
          label: String(level),
          accessibilityLabel: `${valueLabel}, importance ${level} of ${MAX_IMPORTANCE}`,
        }))}
        style={styles.buttons}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.xs },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { flexShrink: 1, fontSize: FONT_SIZES.sm },
  description: { color: COLORS.textSecondary },
  buttons: { alignSelf: 'stretch' },
});
