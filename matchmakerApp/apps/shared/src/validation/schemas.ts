import { z } from 'zod';
import { Gender, SexualOrientation, RelationshipGoal } from '../types';
import { normaliseTag, TAG_MAX_LENGTH } from '../tags';

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
/* Photo feed (FP4)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A tag somebody typed.
 *
 * Normalises as it validates, so whatever passes through comes out canonical.
 * That is the whole point of folding here rather than at the UI: the schema is
 * the one gate every path to storage goes through, so a tag cannot reach the
 * database un-folded even if a future caller forgets to normalise.
 *
 * The transform runs after the length check on the raw input, so the cap applies
 * to what the admin actually typed rather than to the folded result. Both matter:
 * a 30 character tag the fold shortens to 29 is still too long to put on a chip.
 */
export const postTagSchema = z
  .string()
  .trim()
  .min(1, 'A tag cannot be empty')
  .max(TAG_MAX_LENGTH, `Keep tags under ${TAG_MAX_LENGTH} characters`)
  .transform((value) => normaliseTag(value))
  // Folding can empty the string only if the input was whitespace, which the trim
  // and min above already rejected, but a refactor could reintroduce that and a
  // tag called nothing is worse than a rejected one.
  .refine((value) => value.length > 0, 'A tag cannot be empty');

/**
 * Folds, then de-duplicates, keeping the earliest occurrence.
 *
 * Folding is what makes de-duplication necessary: `Dogs` and `  dog ` are two
 * different strings and one tag. Without this, both land in storage, and the
 * taste index counts a reaction twice for a tag the person expressed once, which
 * inflates their affinity with everybody else who likes that photo.
 *
 * Earliest wins rather than rejecting, because the first tag is the primary one
 * and silently moving the primary would be worse than the duplicate. The input
 * component already refuses duplicates, so this is the gate catching a caller
 * that skipped it rather than something a person hits.
 *
 * A factory rather than one shared schema because the two callers want different
 * "you have none" wording, and the count checks have to be applied to the raw
 * list before the transform wraps it.
 */
function postTagListSchema(minMessage: string) {
  return z
    .array(postTagSchema)
    .min(MIN_POST_TAGS, minMessage)
    .max(MAX_POST_TAGS, `At most ${MAX_POST_TAGS} tags, so the primary one stays meaningful`)
    .transform((tags) => {
      const seen = new Set<string>();
      const next: string[] = [];
      for (const tag of tags) {
        if (seen.has(tag)) continue;
        seen.add(tag);
        next.push(tag);
      }
      return next;
    });
}

export const MIN_POST_TAGS = 1;
/**
 * Eight, up from three under the closed set of ten.
 *
 * The count is looser now that tags are free text and cost nothing to invent, but
 * it is still capped: the first tag is the primary one that a co-like is
 * credited to in the match reason, and a photo tagged fifteen ways has no
 * subject. Eight also keeps the chips readable on a narrow phone card, which is
 * where these are edited. The sentence that goes under a match percentage caps
 * itself separately, at three.
 */
export const MAX_POST_TAGS = 8;

export const postSchema = z.object({
  id: z.string().min(1),
  imageUri: z.string(),
  // Optional, not defaulted to ''. A post written before the importer produced
  // a second copy has none, and normalising that to an empty string would make
  // "no thumbnail" indistinguishable from "a thumbnail that failed to load" and
  // would stop the viewer falling back to the full image.
  thumbUri: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  tags: postTagListSchema('Tag the photo so it can be matched on'),
  createdAt: z.string(),
});

export const postReactionSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  postId: z.string().min(1),
  action: z.enum(['like', 'dislike']),
  createdAt: z.string(),
});

/** What the admin importer takes, before ids and timestamps are assigned. */
export const postImportSchema = z.object({
  imageUri: z.string().min(1, 'The image is missing'),
  thumbUri: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  tags: postTagListSchema('Type a tag and press enter'),
});

/** The whole account setup as one validated object, for a backend setup call. */
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
});

export type PostInput = z.infer<typeof postSchema>;
export type PostImportInput = z.infer<typeof postImportSchema>;
export type PostReactionInput = z.infer<typeof postReactionSchema>;

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
export type ProfileSetupInput = z.infer<typeof profileSetupSchema>;
