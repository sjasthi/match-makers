import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ProgressBar, Text } from 'react-native-paper';
import { MAX_VALUES, emptyLifestyle } from '@match-makers/shared';
import type {
  PartnerValue,
  ImportanceScale,
  PromptChoice,
  LifestyleAnswers,
} from '@match-makers/shared';
import {
  ScreenContainer,
  PrimaryButton,
  ErrorBanner,
  SelectChips,
  ImportanceScaleControl,
  type ChipOption,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile } from '@/services/profile';
import { AuthError } from '@/services/auth/AuthError';
import { normaliseQuestionnaire } from '@/services/mock/migrate';
import {
  PROMPT_CHOICES,
  TOTAL_STEPS,
  questionnaireProgress,
  TOP_IMPORTANCE,
  type QuestionnaireStep,
} from '@/prompts';
import {
  LIFESTYLE_OPTIONS,
  LIFESTYLE_QUESTIONS,
  VALUE_OPTIONS,
  labelFor,
} from '@/screens/questionnaireOptions';
import { COLORS, SPACING } from '@/constants';

export interface MatchSetupProps {
  /** Called once the questionnaire is complete, so the caller can show the deck. */
  onComplete?: () => void;
}

/**
 * The questionnaire, asked as one continuous session.
 *
 * This replaces a Prompts screen you entered from the feed one question at a
 * time, with a navigation round trip between each. Answering advances straight
 * on with no navigation, because the session takes the place of the deck rather
 * than living on its own route.
 *
 * Cancel throws away the answer you just gave and leaves that step unanswered.
 * Skipped steps are listed at the end and stay answerable, so nothing is lost
 * and the session is never a trap.
 */
export function MatchSetup({ onComplete }: MatchSetupProps) {
  const user = useAuthStore((store) => store.user);
  const setUser = useAuthStore((store) => store.setUser);

  const progress = questionnaireProgress(user?.questionnaire);

  /**
   * Steps acted on this session, keyed by id.
   *
   * This is deliberately a set of ids rather than a cursor into the remaining
   * list. That list shrinks as each answer lands, so an index would walk past
   * a step every time one was answered, and the queue would quietly skip half
   * the questionnaire.
   */
  const [handled, setHandled] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<QuestionnaireStep[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [reviewCursor, setReviewCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const step = useMemo(() => {
    if (reviewing) return skipped[reviewCursor];
    return progress.remaining.find((candidate) => !handled.includes(candidate.id));
  }, [reviewing, reviewCursor, skipped, progress.remaining, handled]);

  const handledIds = useMemo(() => new Set(handled), [handled]);

  const markHandled = (current: QuestionnaireStep) => {
    setHandled((previous) => [...previous.filter((id) => id !== current.id), current.id]);
    setError(null);
  };

  /**
   * Writes a partial answer set.
   *
   * A half-answered questionnaire is a normal state during a session, so it
   * cannot be validated against the full schema on the way out. It is
   * normalised instead, which is the same code that upgrades records written by
   * older builds: it drops anything self-contradictory, so whatever lands in
   * storage is always well formed even though it is incomplete.
   */
  const persist = async (draft: Record<string, unknown>): Promise<boolean> => {
    const normalised = normaliseQuestionnaire(draft);

    setSaving(true);
    try {
      const updated = await updateProfile({ questionnaire: normalised });
      setUser(updated);
      return true;
    } catch (caught) {
      setError(AuthError.unknown(caught).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const answerTagged = async (choice: PromptChoice): Promise<boolean> => {
    if (!user || !step || step.kind !== 'tagged') return false;
    const current = user.questionnaire;
    const saved = await persist({
      values: current?.values ?? [],
      importance: current?.importance ?? {},
      dealBreakers: current?.dealBreakers ?? [],
      lifestyle: current?.lifestyle,
      prompts: [
        ...(current?.prompts ?? []).filter((answer) => answer.promptId !== step.id),
        { promptId: step.id, tag: step.tag, choice },
      ],
    });
    if (saved) markHandled(step);
    return saved;
  };

  const answerValues = async (
    values: PartnerValue[],
    importance: Record<string, ImportanceScale>,
    dealBreakers: PartnerValue[]
  ): Promise<boolean> => {
    if (!user || !step) return false;
    const saved = await persist({
      values,
      importance,
      dealBreakers,
      prompts: user.questionnaire?.prompts ?? [],
      lifestyle: user.questionnaire?.lifestyle,
    });
    if (saved) markHandled(step);
    return saved;
  };

  const answerLifestyle = async (lifestyle: LifestyleAnswers): Promise<boolean> => {
    if (!user || !step) return false;
    const saved = await persist({
      values: user.questionnaire?.values ?? [],
      importance: user.questionnaire?.importance ?? {},
      dealBreakers: user.questionnaire?.dealBreakers ?? [],
      prompts: user.questionnaire?.prompts ?? [],
      lifestyle,
    });
    if (saved) markHandled(step);
    return saved;
  };

  /** Cancel: keep what was already saved and offer this step again later. */
  const onSkip = () => {
    if (!step) return;
    if (reviewing) {
      setReviewCursor((current) => current + 1);
      return;
    }
    setSkipped((current) => [...current.filter((s) => s.id !== step.id), step]);
    markHandled(step);
  };

  if (!user) return <ScreenContainer />;

  if (reviewing && step) {
    return (
      <ScreenContainer scroll>
        <View style={styles.header}>
          <Text variant="labelLarge" style={styles.progressLabel}>
            Skipped · {reviewCursor + 1} of {skipped.length}
          </Text>
          <ProgressBar progress={(reviewCursor + 1) / Math.max(1, skipped.length)} />
        </View>

        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        {step.kind === 'values' ? (
          <ValuesStep
            key={step.id}
            questionnaire={user.questionnaire}
            saving={saving}
            onSubmit={async (values, importance, dealBreakers) => {
              const saved = await answerValues(values, importance, dealBreakers);
              if (saved) setReviewCursor((current) => current + 1);
              return saved;
            }}
          />
        ) : step.kind === 'lifestyle' ? (
          <LifestyleStep
            key={step.id}
            questionnaire={user.questionnaire}
            saving={saving}
            onSubmit={async (lifestyle) => {
              const saved = await answerLifestyle(lifestyle);
              if (saved) setReviewCursor((current) => current + 1);
              return saved;
            }}
          />
        ) : (
          <TaggedStep
            step={step}
            saving={saving}
            onAnswer={async (choice) => {
              const saved = await answerTagged(choice);
              if (saved) setReviewCursor((current) => current + 1);
              return saved;
            }}
            onCancel={onSkip}
          />
        )}

        <View style={styles.actions}>
          <PrimaryButton
            onPress={() => {
              setReviewing(false);
              setReviewCursor(0);
            }}
            variant="text"
            fullWidth
          >
            Back
          </PrimaryButton>
        </View>
      </ScreenContainer>
    );
  }

  const sessionOver = progress.remaining.every((candidate) => handledIds.has(candidate.id));

  if (progress.complete && sessionOver) {
    return (
      <ScreenContainer>
        <View style={styles.centered}>
          <Text variant="headlineSmall" style={styles.question}>
            All done
          </Text>
          <Text variant="bodyMedium" style={styles.body}>
            Your answers are what your match scores are made of.
          </Text>
        </View>
        <PrimaryButton onPress={onComplete} fullWidth>
          See who is out there
        </PrimaryButton>
      </ScreenContainer>
    );
  }

  if (sessionOver && skipped.length > 0) {
    return (
      <ScreenContainer>
        <View style={styles.header}>
          <Text variant="labelLarge" style={styles.progressLabel}>
            {progress.answeredCount} of {TOTAL_STEPS} answered
          </Text>
          <ProgressBar progress={progress.answeredCount / TOTAL_STEPS} />
        </View>

        <View style={styles.card}>
          <Text variant="headlineSmall" style={styles.question}>
            {skipped.length} skipped
          </Text>
          <Text variant="bodyMedium" style={styles.body}>
            Nothing was saved for these. Pick them up whenever you like.
          </Text>
          {skipped.map((item) => (
            <View key={item.id} style={styles.skippedRow}>
              <Text variant="bodyMedium">{stepTitle(item)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            onPress={() => {
              setReviewCursor(0);
              setReviewing(true);
            }}
            fullWidth
          >
            Answer the rest
          </PrimaryButton>
          <PrimaryButton onPress={onComplete} variant="text" fullWidth>
            Done for now
          </PrimaryButton>
        </View>
      </ScreenContainer>
    );
  }

  if (!step) return <ScreenContainer />;

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text variant="labelLarge" style={styles.progressLabel}>
          {progress.answeredCount + 1} of {TOTAL_STEPS}
        </Text>
        <ProgressBar progress={progress.answeredCount / TOTAL_STEPS} />
      </View>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {step.kind === 'values' ? (
        <ValuesStep
          key={step.id}
          questionnaire={user.questionnaire}
          saving={saving}
          onSubmit={answerValues}
        />
      ) : step.kind === 'lifestyle' ? (
        <LifestyleStep
          key={step.id}
          questionnaire={user.questionnaire}
          saving={saving}
          onSubmit={answerLifestyle}
        />
      ) : (
        <TaggedStep step={step} saving={saving} onAnswer={answerTagged} onCancel={onSkip} />
      )}

      {step.kind !== 'tagged' ? (
        <View style={styles.actions}>
          <PrimaryButton onPress={onSkip} variant="text" fullWidth>
            Skip this
          </PrimaryButton>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

function stepTitle(step: QuestionnaireStep): string {
  if (step.kind === 'values') return 'What matters to you';
  if (step.kind === 'lifestyle') return 'Day to day';
  return step.question;
}

interface TaggedStepProps {
  step: Extract<QuestionnaireStep, { kind: 'tagged' }>;
  saving: boolean;
  onAnswer: (choice: PromptChoice) => Promise<boolean>;
  onCancel: () => void;
}

function TaggedStep({ step, saving, onAnswer, onCancel }: TaggedStepProps) {
  return (
    <View style={styles.card}>
      <Text variant="headlineSmall" style={styles.question}>
        {step.question}
      </Text>
      {step.noteHint ? (
        <Text variant="bodySmall" style={styles.body}>
          {step.noteHint}
        </Text>
      ) : null}

      <SelectChips
        testID="prompt-choices"
        label="Your answer"
        options={PROMPT_CHOICES as ReadonlyArray<ChipOption<PromptChoice>>}
        selected={[]}
        onToggle={(choice) => {
          if (!saving) void onAnswer(choice);
        }}
        multiple={false}
      />

      <PrimaryButton onPress={onCancel} variant="text" fullWidth disabled={saving}>
        Cancel
      </PrimaryButton>
    </View>
  );
}

interface ValuesStepProps {
  questionnaire:
    { values?: PartnerValue[]; importance?: Record<string, ImportanceScale> } | undefined;
  saving: boolean;
  /** Resolves true once the answer is stored, so the caller can advance. */
  onSubmit: (
    values: PartnerValue[],
    importance: Record<string, ImportanceScale>,
    dealBreakers: PartnerValue[]
  ) => Promise<boolean>;
}

/**
 * Pick the values that matter and grade each one.
 *
 * The grade is the weight the matching engine reads, so a value with no grade
 * is not an answer yet. That is why this is one step rather than two: a partly
 * graded list is not something worth storing.
 */
function ValuesStep({ questionnaire, saving, onSubmit }: ValuesStepProps) {
  const [values, setValues] = useState<PartnerValue[]>(questionnaire?.values ?? []);
  const [importance, setImportance] = useState<Record<string, ImportanceScale>>(
    questionnaire?.importance ?? {}
  );
  const [dealBreakers, setDealBreakers] = useState<PartnerValue[]>([]);

  const atCap = values.length >= MAX_VALUES;
  const ungraded = values.filter((value) => importance[value] === undefined);

  const toggle = (value: PartnerValue) => {
    if (values.includes(value)) {
      // Dropping a value takes its grade and its deal-breaker flag with it, or
      // the stored answer contradicts itself.
      setValues((current) => current.filter((item) => item !== value));
      setImportance((current) => {
        const next = { ...current };
        delete next[value];
        return next;
      });
      setDealBreakers((current) => current.filter((item) => item !== value));
      return;
    }
    if (atCap) return;
    setValues((current) => [...current, value]);
  };

  const toggleDealBreaker = (value: PartnerValue) => {
    if (dealBreakers.includes(value)) {
      setDealBreakers((current) => current.filter((item) => item !== value));
      return;
    }
    setDealBreakers([value]);
    // A deal breaker is the most important thing on the list, so promoting it
    // is what stops the two answers disagreeing.
    setImportance((current) => ({ ...current, [value]: TOP_IMPORTANCE }));
  };

  return (
    <View style={styles.card}>
      <Text variant="headlineSmall" style={styles.question}>
        What matters to you?
      </Text>
      <Text variant="bodyMedium" style={styles.body}>
        Pick up to {MAX_VALUES} and tell us how much each one counts.
      </Text>

      <SelectChips
        testID="value-chips"
        label={`Values (${values.length}/${MAX_VALUES})`}
        options={VALUE_OPTIONS}
        selected={values}
        onToggle={toggle}
        error={values.length === 0}
        helperText={
          atCap
            ? 'That is the maximum. Remove one to swap it.'
            : 'Tap to select, tap again to clear.'
        }
      />

      {values.length > 0 ? (
        <View style={styles.block}>
          <Text variant="labelLarge">How important is each one?</Text>
          {values.map((value) => (
            <ImportanceScaleControl
              key={value}
              valueLabel={labelFor(VALUE_OPTIONS, value)}
              value={importance[value]}
              onChange={(level) => setImportance((current) => ({ ...current, [value]: level }))}
            />
          ))}
        </View>
      ) : null}

      {values.length > 0 ? (
        <SelectChips
          testID="deal-breaker-chips"
          label="Anything that is a deal breaker?"
          // Only the values actually picked: a deal breaker on something you
          // did not choose is not an answer, and the schema rejects it.
          options={VALUE_OPTIONS.filter((option) => values.includes(option.value))}
          selected={dealBreakers}
          onToggle={toggleDealBreaker}
          multiple={false}
          helperText="We treat this as non-negotiable. Optional."
        />
      ) : null}

      <PrimaryButton
        onPress={() => onSubmit(values, importance, dealBreakers)}
        disabled={saving || values.length === 0 || ungraded.length > 0}
        loading={saving}
        fullWidth
      >
        {ungraded.length > 0 ? 'Rate them all first' : 'Continue'}
      </PrimaryButton>
    </View>
  );
}

interface LifestyleStepProps {
  questionnaire: { lifestyle?: LifestyleAnswers } | undefined;
  saving: boolean;
  onSubmit: (lifestyle: LifestyleAnswers) => Promise<boolean>;
}

function LifestyleStep({ questionnaire, saving, onSubmit }: LifestyleStepProps) {
  const [lifestyle, setLifestyle] = useState<LifestyleAnswers>(
    questionnaire?.lifestyle ?? emptyLifestyle()
  );

  return (
    <View style={styles.card}>
      <Text variant="headlineSmall" style={styles.question}>
        Day to day
      </Text>
      <Text variant="bodyMedium" style={styles.body}>
        The unglamorous stuff. It filters people out early, which saves everyone time.
      </Text>

      {LIFESTYLE_QUESTIONS.map((question) => (
        <SelectChips
          key={question.key}
          label={question.label}
          options={LIFESTYLE_OPTIONS[question.key]}
          selected={[lifestyle[question.key]]}
          onToggle={(value) => setLifestyle((current) => ({ ...current, [question.key]: value }))}
          multiple={false}
          helperText={question.helper}
        />
      ))}

      <PrimaryButton
        onPress={() => onSubmit(lifestyle)}
        disabled={saving}
        loading={saving}
        fullWidth
      >
        Continue
      </PrimaryButton>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: SPACING.xs, marginBottom: SPACING.lg },
  progressLabel: { color: COLORS.textSecondary },
  card: { gap: SPACING.lg, marginBottom: SPACING.lg },
  question: { fontWeight: '700' },
  body: { color: COLORS.textSecondary },
  block: { gap: SPACING.md },
  actions: { gap: SPACING.sm },
  skippedRow: { paddingVertical: SPACING.xs },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.md },
});
