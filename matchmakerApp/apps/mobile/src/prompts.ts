import { PromptChoice, PromptTag, ImportanceScale, emptyLifestyle } from '@match-makers/shared';
import type { ChipOption } from '@/components';
import type { UserQuestionnaire } from '@match-makers/shared';

/**
 * A question the app asks, in the order it asks them.
 *
 * The whole FP3 questionnaire is expressed as steps rather than as separate
 * screens. One continuous session with no navigation between screens is what
 * removed the "answer one, go back, answer the next" loop, and it also means
 * values and lifestyle get asked here too. They used to have no interface at
 * all, which left 30 of the 100 match points permanently at zero.
 */
export type QuestionnaireStep =
  | { kind: 'values'; id: 'values' }
  | { kind: 'lifestyle'; id: 'lifestyle' }
  | {
      kind: 'tagged';
      id: string;
      tag: PromptTag;
      question: string;
      noteHint?: string;
    };

/**
 * One of the tagged prompts.
 *
 * A prompt is a real question carrying a tag, so two people who both answered
 * it are answering the same thing. That is what makes the comparison meaningful:
 * an earlier version collected 24 free-floating interest tags and compared
 * those, and almost no two people happened to pick the same set, so the signal
 * never moved off zero.
 *
 * Every prompt accepts the same four answers. Keeping one closed set is what
 * makes the score honest: a percentage over free text would be a guess.
 */
export interface TaggedPrompt {
  /** Stable and stored on the answer, so copy can be reworded freely. */
  id: string;
  tag: PromptTag;
  question: string;
  /** Shown under the answer on the other person's card. Never scored. */
  noteHint?: string;
}

export const TAGGED_PROMPTS: ReadonlyArray<TaggedPrompt> = [
  {
    id: 'family',
    tag: PromptTag.FAMILY,
    question: 'I want kids',
    noteHint: 'Add a line about what that looks like for you',
  },
  {
    id: 'outdoors',
    tag: PromptTag.LEISURE,
    question: 'My ideal weekend is spent outside',
  },
  {
    id: 'kitchen',
    tag: PromptTag.FOOD,
    question: "I'd rather cook than eat out",
  },
  {
    id: 'playlist',
    tag: PromptTag.MUSIC,
    question: 'Music matters more to me than film',
  },
  {
    id: 'learning',
    tag: PromptTag.LEARNING,
    question: "I'd rather be learning something than resting",
  },
  {
    id: 'far',
    tag: PromptTag.TRAVEL,
    question: 'I want to travel far rather than often',
  },
  {
    id: 'slow',
    tag: PromptTag.RECOVERY,
    question: 'Sundays are for doing nothing',
  },
  {
    id: 'respect',
    tag: PromptTag.CHARACTER,
    question: 'Doing what you said you would is how I earn respect',
  },
];

const ALL_CHOICES: ReadonlyArray<ChipOption<PromptChoice>> = [
  { value: PromptChoice.YES, label: 'Yes' },
  { value: PromptChoice.SOMETIMES, label: 'Sometimes' },
  { value: PromptChoice.DEPENDS, label: 'It depends' },
  { value: PromptChoice.NO, label: 'No' },
];

export const PROMPT_CHOICES = ALL_CHOICES;

/** Short label for a choice, used on the other person's card. */
export function choiceLabel(choice: PromptChoice): string {
  return ALL_CHOICES.find((option) => option.value === choice)?.label ?? choice;
}

export function taggedPromptById(id: string): TaggedPrompt | undefined {
  return TAGGED_PROMPTS.find((prompt) => prompt.id === id);
}

export function taggedPromptByTag(tag: PromptTag): TaggedPrompt | undefined {
  return TAGGED_PROMPTS.find((prompt) => prompt.tag === tag);
}

/** Short label for a tag, used to say which prompts two people share. */
export function tagLabel(tag: PromptTag): string {
  return taggedPromptByTag(tag)?.question ?? tag;
}

/**
 * The steps in the order they are asked, heaviest signal first.
 *
 * Values carry 30 of the 100 points and the tagged prompts 5, so they lead.
 * Lifestyle sits between them: it is a single tap-through, since it ships with
 * defaults, so putting it second costs almost nothing.
 */
export const QUESTIONNAIRE_STEPS: ReadonlyArray<QuestionnaireStep> = [
  { kind: 'values', id: 'values' },
  { kind: 'lifestyle', id: 'lifestyle' },
  ...TAGGED_PROMPTS.map((prompt): QuestionnaireStep => ({ kind: 'tagged', ...prompt })),
];

export const TOTAL_STEPS = QUESTIONNAIRE_STEPS.length;

/** True when the values step has something usable: at least one, all graded. */
function valuesAnswered(questionnaire: UserQuestionnaire | undefined): boolean {
  const values = questionnaire?.values ?? [];
  if (values.length === 0) return false;
  return values.every((value) => questionnaire?.importance?.[value] !== undefined);
}

/** True when every lifestyle answer is still the shipped default. */
function lifestyleUntouched(questionnaire: UserQuestionnaire | undefined): boolean {
  const defaults = emptyLifestyle();
  const current = questionnaire?.lifestyle;
  if (!current) return true;
  return (Object.keys(defaults) as Array<keyof typeof defaults>).every(
    (key) => current[key] === defaults[key]
  );
}

/**
 * Whether a step still needs an answer.
 *
 * Lifestyle is offered once and then stops being offered, rather than counting
 * as a requirement. It ships with valid defaults, so blocking on it would be
 * inventing work, but leaving it permanently unreachable would mean those
 * defaults were never really chosen. Once anything differs from the default the
 * step is treated as asked.
 *
 * Values and the tagged prompts do block, because without them the score is not
 * measurable.
 */
export function isStepAnswered(
  step: QuestionnaireStep,
  questionnaire: UserQuestionnaire | undefined
): boolean {
  switch (step.kind) {
    case 'values':
      return valuesAnswered(questionnaire);
    case 'lifestyle':
      return !lifestyleUntouched(questionnaire);
    case 'tagged':
      return (questionnaire?.prompts ?? []).some((answer) => answer.promptId === step.id);
  }
}

/** The steps still outstanding, in the order they will be asked. */
export function remainingSteps(questionnaire: UserQuestionnaire | undefined): QuestionnaireStep[] {
  return QUESTIONNAIRE_STEPS.filter((step) => !isStepAnswered(step, questionnaire));
}

export interface QuestionnaireProgress {
  answeredCount: number;
  total: number;
  remaining: QuestionnaireStep[];
  /** True once nothing is left, which is what unlocks the deck. */
  complete: boolean;
}

export function questionnaireProgress(
  questionnaire: UserQuestionnaire | undefined
): QuestionnaireProgress {
  const remaining = remainingSteps(questionnaire);
  return {
    answeredCount: TOTAL_STEPS - remaining.length,
    total: TOTAL_STEPS,
    remaining,
    complete: remaining.length === 0,
  };
}

/** The highest grade, which is what a deal breaker is promoted to. */
export const TOP_IMPORTANCE = ImportanceScale.NON_NEGOTIABLE;
/** Alias kept because most surfaces care about the tagged prompts only. */
export const PROMPTS = TAGGED_PROMPTS;

export function promptById(id: string): TaggedPrompt | undefined {
  return taggedPromptById(id);
}

/**
 * The question text for a stored answer.
 *
 * Falls back to the tag so an answer saved against a prompt that has since been
 * retired reads as "family" rather than as a bare id.
 */
export function promptQuestion(promptId: string, tag: PromptTag): string {
  return taggedPromptById(promptId)?.question ?? tagLabel(tag);
}

/** The tagged prompts a person has not answered yet, in registry order. */
export function unansweredPromptIds(answeredIds: readonly string[]): string[] {
  return TAGGED_PROMPTS.filter((prompt) => !answeredIds.includes(prompt.id)).map(
    (prompt) => prompt.id
  );
}
