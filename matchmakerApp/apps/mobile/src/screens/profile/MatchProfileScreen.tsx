import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MAX_IMPORTANCE, type ImportanceScale, type UserQuestionnaire } from '@match-makers/shared';
import { ScreenContainer, AppIcon } from '@/components';
import { COLORS, SPACING } from '@/constants';
import {
  DRINKING_OPTIONS,
  EXERCISE_OPTIONS,
  PETS_OPTIONS,
  SCHEDULE_OPTIONS,
  SMOKING_OPTIONS,
  VALUE_OPTIONS,
  labelFor,
} from '@/screens/questionnaireOptions';
import { choiceLabel, promptQuestion } from '@/prompts';

const IMPORTANCE_DESCRIPTIONS: Record<ImportanceScale, string> = {
  1: 'Nice to have',
  2: 'Fairly important',
  3: 'Important',
  4: 'Very important',
  5: 'Non-negotiable',
};

interface MatchProfileScreenProps {
  questionnaire: UserQuestionnaire | undefined;
}

interface RowProps {
  label: string;
  value?: string;
}

/**
 * Read-only view of the questionnaire answers.
 *
 * This exists so the FP3 work is inspectable rather than just collected: it is
 * what the numbers would be read from once the matching engine lands. It shows
 * the stored answers verbatim and deliberately does not turn them into a score,
 * because no scoring exists yet.
 */
export function MatchProfileScreen({ questionnaire }: MatchProfileScreenProps) {
  if (!questionnaire) {
    return (
      <ScreenContainer>
        <View style={styles.empty}>
          <AppIcon name="clipboard-alert-outline" size={56} color={COLORS.warning} />
          <Text variant="headlineSmall" style={styles.title}>
            Nothing recorded yet
          </Text>
          <Text variant="bodyMedium" style={styles.body}>
            Answer the questionnaire and your answers will show up here.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const lifestyle = questionnaire.lifestyle;

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>
          Your match profile
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          The answers the matching engine will read. Nothing is scored from them yet.
        </Text>
      </View>

      <Section title="Values">
        {questionnaire.values.map((value) => (
          <View key={value} style={styles.valueRow}>
            <View style={styles.valueHeader}>
              <Text variant="titleSmall" style={styles.valueLabel}>
                {labelFor(VALUE_OPTIONS, value)}
              </Text>
              {questionnaire.dealBreakers.includes(value) ? (
                <Text variant="labelSmall" style={styles.dealBreaker}>
                  Deal breaker
                </Text>
              ) : null}
            </View>
            <ImportanceBar importance={questionnaire.importance[value]} />
          </View>
        ))}
      </Section>

      <Section title={`Prompts (${questionnaire.prompts.length})`}>
        {questionnaire.prompts.map((answer) => (
          <View key={answer.promptId} style={styles.promptRow}>
            <Text variant="bodyMedium" style={styles.promptQuestion}>
              {promptQuestion(answer.promptId, answer.tag)}
            </Text>
            <Text variant="titleSmall" style={styles.promptChoice}>
              {choiceLabel(answer.choice)}
            </Text>
            {answer.note ? (
              <Text variant="bodySmall" style={styles.promptNote}>
                {answer.note}
              </Text>
            ) : null}
          </View>
        ))}
      </Section>

      <Section title="Lifestyle">
        <Row label="Schedule" value={labelFor(SCHEDULE_OPTIONS, lifestyle.schedule)} />
        <Row label="Exercise" value={labelFor(EXERCISE_OPTIONS, lifestyle.exercise)} />
        <Row label="Smoking" value={labelFor(SMOKING_OPTIONS, lifestyle.smoking)} />
        <Row label="Drinking" value={labelFor(DRINKING_OPTIONS, lifestyle.drinking)} />
        <Row label="Pets" value={labelFor(PETS_OPTIONS, lifestyle.pets)} />
      </Section>
    </ScreenContainer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="titleMedium" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ label, value }: RowProps) {
  return (
    <View style={styles.row}>
      <Text variant="bodyMedium" style={styles.rowLabel}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={styles.rowValue}>
        {value ?? '—'}
      </Text>
    </View>
  );
}

/** Draws the 1 to 5 grade as filled dots rather than a number. */
function ImportanceBar({ importance }: { importance: ImportanceScale | undefined }) {
  const level = importance ?? 0;
  return (
    <View style={styles.importanceRow}>
      <View style={styles.dots}>
        {Array.from({ length: MAX_IMPORTANCE }, (_, index) => (
          <View
            key={index}
            style={[styles.dot, index < level && styles.dotFilled]}
            testID={index < level ? 'importance-dot-filled' : 'importance-dot-empty'}
          />
        ))}
      </View>
      <Text variant="bodySmall" style={styles.importanceLabel}>
        {importance === undefined ? 'Not rated' : IMPORTANCE_DESCRIPTIONS[importance]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: SPACING.xs, marginBottom: SPACING.lg },
  title: { fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary },
  section: { gap: SPACING.sm, marginBottom: SPACING.lg },
  sectionTitle: { fontWeight: '700' },
  valueRow: { gap: SPACING.xs, paddingVertical: SPACING.xs },
  valueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  valueLabel: { fontWeight: '600' },
  dealBreaker: { color: COLORS.primary, fontWeight: '700' },
  importanceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dots: { flexDirection: 'row', gap: SPACING.xs },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.surfaceVariant },
  dotFilled: { backgroundColor: COLORS.primary },
  importanceLabel: { color: COLORS.textSecondary },
  promptRow: { gap: 2, paddingVertical: SPACING.xs },
  promptQuestion: { color: COLORS.textSecondary },
  promptChoice: { fontWeight: '700' },
  promptNote: { color: COLORS.textSecondary, fontStyle: 'italic' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs },
  rowLabel: { color: COLORS.textSecondary },
  rowValue: { fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.md },
  body: { color: COLORS.textSecondary, textAlign: 'center' },
});
