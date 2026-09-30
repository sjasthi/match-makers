import { z } from 'zod';
import { Gender, SexualOrientation, RelationshipGoal } from '../types';

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

export const profileSetupSchema = z.object({
  name: nameSchema,
  dateOfBirth: dateOfBirthSchema,
  gender: genderSchema,
  sexualOrientation: sexualOrientationSchema,
  relationshipGoal: relationshipGoalSchema,
  bio: bioSchema,
  photos: z
    .array(z.instanceof(File))
    .min(1, 'At least one photo is required')
    .max(6, 'Maximum 6 photos'),
  location: locationSchema,
  preferences: preferencesSchema,
});

export const photoSchema = z.object({
  uri: z.string(),
  type: z.string(),
  name: z.string(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ProfileSetupInput = z.infer<typeof profileSetupSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
