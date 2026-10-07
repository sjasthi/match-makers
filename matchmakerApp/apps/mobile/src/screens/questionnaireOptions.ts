import {
  PartnerValue,
  ScheduleType,
  ExerciseLevel,
  SmokingStatus,
  DrinkingStatus,
  PetsPreference,
} from '@match-makers/shared';
import type { ChipOption } from '@/components';
import type { LifestyleAnswers } from '@match-makers/shared';

/**
 * Display labels for the questionnaire enums.
 *
 * Kept beside the screens rather than in shared, because these strings are
 * copy the UI owns. The wire format is the enum value, which is what the
 * backend and the future matching engine compare, so a label can be reworded
 * without touching stored data.
 */
export const VALUE_OPTIONS: ReadonlyArray<ChipOption<PartnerValue>> = [
  { value: PartnerValue.KINDNESS, label: 'Kindness' },
  { value: PartnerValue.SENSE_OF_HUMOUR, label: 'Sense of humour' },
  { value: PartnerValue.EMOTIONAL_OPENNESS, label: 'Emotional openness' },
  { value: PartnerValue.SHARED_INTERESTS, label: 'Shared interests' },
  { value: PartnerValue.AMBITION, label: 'Ambition' },
  { value: PartnerValue.PHYSICAL_CLOSENESS, label: 'Physical closeness' },
  { value: PartnerValue.INDEPENDENCE, label: 'Independence' },
  { value: PartnerValue.FAMILY, label: 'Family' },
];

export const SCHEDULE_OPTIONS: ReadonlyArray<ChipOption<ScheduleType>> = [
  { value: ScheduleType.EARLY_BIRD, label: 'Early bird' },
  { value: ScheduleType.NIGHT_OWL, label: 'Night owl' },
  { value: ScheduleType.FLEXIBLE, label: 'Flexible' },
];

export const EXERCISE_OPTIONS: ReadonlyArray<ChipOption<ExerciseLevel>> = [
  { value: ExerciseLevel.NONE, label: 'Not really' },
  { value: ExerciseLevel.LIGHT, label: 'A bit' },
  { value: ExerciseLevel.MODERATE, label: 'Most weeks' },
  { value: ExerciseLevel.A_LOT, label: 'Most days' },
];

export const SMOKING_OPTIONS: ReadonlyArray<ChipOption<SmokingStatus>> = [
  { value: SmokingStatus.NEVER, label: 'Never' },
  { value: SmokingStatus.SOCIALLY, label: 'Socially' },
  { value: SmokingStatus.DAILY, label: 'Daily' },
  { value: SmokingStatus.PREFER_NOT_TO_SAY, label: 'Prefer not to say' },
];

export const DRINKING_OPTIONS: ReadonlyArray<ChipOption<DrinkingStatus>> = [
  { value: DrinkingStatus.NEVER, label: 'Never' },
  { value: DrinkingStatus.SOCIALLY, label: 'Socially' },
  { value: DrinkingStatus.OFTEN, label: 'Often' },
  { value: DrinkingStatus.PREFER_NOT_TO_SAY, label: 'Prefer not to say' },
];

export const PETS_OPTIONS: ReadonlyArray<ChipOption<PetsPreference>> = [
  { value: PetsPreference.LOVE_PETS, label: 'Love pets' },
  { value: PetsPreference.HAVE_PETS, label: 'Have pets' },
  { value: PetsPreference.ALLERGIC, label: 'Allergic' },
  { value: PetsPreference.NO_PREFERENCE, label: 'No preference' },
];

/** Reverse lookup so the stored enum can be rendered back as copy. */
export function labelFor<T extends string>(
  options: ReadonlyArray<ChipOption<T>>,
  value: T
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** The chip groups for each lifestyle question, keyed by answer field. */
export const LIFESTYLE_OPTIONS: {
  [K in keyof LifestyleAnswers]: ReadonlyArray<ChipOption<LifestyleAnswers[K]>>;
} = {
  schedule: SCHEDULE_OPTIONS,
  exercise: EXERCISE_OPTIONS,
  smoking: SMOKING_OPTIONS,
  drinking: DRINKING_OPTIONS,
  pets: PETS_OPTIONS,
};

/** Copy for the lifestyle questions, in the order they are asked. */
export const LIFESTYLE_QUESTIONS: ReadonlyArray<{
  key: keyof LifestyleAnswers;
  label: string;
  helper?: string;
}> = [
  { key: 'schedule', label: 'Your schedule', helper: 'Early starts and late nights do not mix.' },
  { key: 'exercise', label: 'Exercise' },
  { key: 'smoking', label: 'Smoking' },
  { key: 'drinking', label: 'Drinking' },
  { key: 'pets', label: 'Pets' },
];
