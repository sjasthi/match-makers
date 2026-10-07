import { z } from 'zod';
import {
  Gender,
  SexualOrientation,
  RelationshipGoal,
  PartnerValue,
  PromptTag,
  PromptChoice,
  ScheduleType,
  ExerciseLevel,
  SmokingStatus,
  DrinkingStatus,
  PetsPreference,
  ImportanceScale,
} from '../types';

export { MIN_IMPORTANCE, MAX_IMPORTANCE } from '../types';

export const emailSchema = z.string().email('Invalid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const nameSchema = z
  .string()
  .min(2, 'Name must be at least 2 characters')
  .max(50, 'Name must be at most 50 characters')
  .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes');

export const dateOfBirthSchema = z.string().refine(
  (date) => {
    const dob = new Date(date);
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    const dayDiff = today.getDate() - dob.getDate();
    const actualAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;
    return actualAge >= 18 && actualAge <= 100;
  },
  { message: 'You must be between 18 and 100 years old' }
);

export const bioSchema = z
  .string()
  .max(500, 'Bio must be at most 500 characters')
  .optional()
  .default('');

export const genderSchema = z.nativeEnum(Gender);
export const sexualOrientationSchema = z.nativeEnum(SexualOrientation);
export const relationshipGoalSchema = z.nativeEnum(RelationshipGoal);
export const distanceModeSchema = z.enum(['nearby', 'global']);

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  city: z.string().min(1),
  country: z.string().min(1),
});

export const preferencesSchema = z.object({
  ageRange: z
    .object({
      min: z.number().min(18).max(99),
      max: z.number().min(19).max(100),
    })
    .refine((data) => data.min < data.max, {
      message: 'Minimum age must be less than maximum age',
    }),
  distanceMode: distanceModeSchema,
  // Validated whether or not the mode is `global`, because the value is
  // carried through `global` mode precisely so it survives the round trip back
  // to `nearby`. Rejecting an out-of-range radius only while it is hidden would
  // let a profile fail validation on a field the user cannot see or edit.
  maxDistance: z.number().min(1).max(500),
  genders: z.array(genderSchema).min(1, 'Select at least one gender'),
  relationshipGoals: z.array(relationshipGoalSchema).min(1, 'Select at least one goal'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    name: nameSchema,
    dateOfBirth: dateOfBirthSchema,
    gender: genderSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const photoSchema = z.object({
  uri: z.string(),
  type: z.string(),
  name: z.string(),
});

/* -------------------------------------------------------------------------- */
/* Questionnaire (FP3)                                                         */
/* -------------------------------------------------------------------------- */

export const MAX_VALUES = 5;
/** Enough prompts for the score to mean something without burying the user. */
export const MIN_PROMPTS = 2;

export const partnerValueSchema = z.nativeEnum(PartnerValue);
export const importanceSchema = z.nativeEnum(ImportanceScale);

export const lifestyleSchema = z.object({
  schedule: z.nativeEnum(ScheduleType),
  exercise: z.nativeEnum(ExerciseLevel),
  smoking: z.nativeEnum(SmokingStatus),
  drinking: z.nativeEnum(DrinkingStatus),
  pets: z.nativeEnum(PetsPreference),
});

export const promptTagSchema = z.nativeEnum(PromptTag);
export const promptChoiceSchema = z.nativeEnum(PromptChoice);

export const promptAnswerSchema = z.object({
  promptId: z.string().min(1),
  tag: promptTagSchema,
  choice: promptChoiceSchema,
  note: z.string().max(280, 'Keep it under 280 characters').optional(),
});

export const questionnaireSchema = z
  .object({
    values: z.array(partnerValueSchema).min(1, 'Pick at least one value').max(MAX_VALUES),
    importance: z.record(partnerValueSchema, importanceSchema),
    dealBreakers: z.array(partnerValueSchema).max(MAX_VALUES),
    prompts: z
      .array(promptAnswerSchema)
      .min(MIN_PROMPTS, 'Answer at least one prompt')
      .max(Object.keys(PromptTag).length),
    lifestyle: lifestyleSchema,
  })
  // A value you picked but never graded carries no weight, so the matching
  // engine would have to guess at it. Reject instead of defaulting.
  .refine((data) => data.values.every((value) => data.importance[value] !== undefined), {
    message: 'Every value you picked needs an importance rating',
    path: ['importance'],
  })
  // A deal breaker that is not in `values` contradicts the rest of the answer.
  .refine((data) => data.dealBreakers.every((value) => data.values.includes(value)), {
    message: 'A deal breaker has to be one of the values you picked',
    path: ['dealBreakers'],
  })
  // Two answers to the same prompt would score as one tag but read as two
  // different opinions on the other person's card.
  .refine(
    (data) => new Set(data.prompts.map((answer) => answer.tag)).size === data.prompts.length,
    {
      message: 'One answer per prompt',
      path: ['prompts'],
    }
  );

/** The whole questionnaire as one validated object, for a backend setup call. */
export const profileSetupSchema = z.object({
  name: nameSchema,
  dateOfBirth: dateOfBirthSchema,
  gender: genderSchema,
  sexualOrientation: sexualOrientationSchema,
  relationshipGoal: relationshipGoalSchema,
  bio: bioSchema,
  photos: z.array(photoSchema).min(1, 'At least one photo is required').max(6, 'Maximum 6 photos'),
  location: locationSchema,
  preferences: preferencesSchema,
  questionnaire: questionnaireSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
export type ProfileSetupInput = z.infer<typeof profileSetupSchema>;
export type LifestyleInput = z.infer<typeof lifestyleSchema>;
export type QuestionnaireInput = z.infer<typeof questionnaireSchema>;

/** An empty, valid set of lifecycle answers to seed a draft with. */
export function emptyLifestyle(): z.infer<typeof lifestyleSchema> {
  return {
    schedule: ScheduleType.FLEXIBLE,
    exercise: ExerciseLevel.LIGHT,
    smoking: SmokingStatus.NEVER,
    drinking: DrinkingStatus.SOCIALLY,
    pets: PetsPreference.NO_PREFERENCE,
  };
}
