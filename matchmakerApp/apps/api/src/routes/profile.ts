import { Router } from 'express';
import {
  bioSchema,
  dateOfBirthSchema,
  genderSchema,
  locationSchema,
  nameSchema,
  preferencesSchema,
  relationshipGoalSchema,
  sexualOrientationSchema,
} from '@match-makers/shared';
import type { Photo, VerificationStatus } from '@match-makers/shared';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { currentUserId, requireAuth } from '@/auth';
import { eligibilitySql } from '@/eligibility';
import { pool, withTransaction } from '@/db';
import { getUserById } from '@/db/users';
import { ApiError } from '@/errors';
import { asyncHandler, parse, send } from '@/http';
import { rescoreForViewer } from '@/matching';

export const profileRouter = Router();

/**
 * A profile photo, in the domain `Photo` shape -- `{ id, url, isPrimary, order }`.
 *
 * NOT `photoSchema` from `@match-makers/shared`, despite the near-identical
 * name. That schema validates `{ uri, type, name }`, which is what
 * `expo-image-picker` returns *before* `services/imageImport.ts` has resized it
 * and written a storable URI.
 *
 * `profileSetupSchema` composes it into the field documented as "the contract
 * for a single setup call", so that contract does not currently match the
 * `Photo[]` on `ProfileSetupPayload` that it claims to describe. Left alone
 * deliberately: `photoSchema` is on the picker's path in the app, so correcting
 * it means touching the mobile app in a change that is meant to be about the
 * database. Flagged in the README.
 */
const profilePhotoSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  isPrimary: z.boolean(),
  order: z.number().int().min(0),
}) satisfies z.ZodType<Photo>;

/**
 * Profile edits.
 *
 * Every field is individually optional, because onboarding saves one section at
 * a time. `MockAuthAdapter.updateProfile` takes a `Partial<User>` and does a
 * shallow merge for exactly that reason, and requiring a whole profile object
 * would mean the app had to send fields it has not collected yet.
 */
const patchProfileSchema = z.object({
  name: nameSchema.optional(),
  dateOfBirth: dateOfBirthSchema.optional(),
  gender: genderSchema.optional(),
  sexualOrientation: sexualOrientationSchema.optional(),
  relationshipGoal: relationshipGoalSchema.optional(),
  bio: bioSchema.optional(),
  location: locationSchema.optional(),
  preferences: preferencesSchema.optional(),
  photos: z.array(profilePhotoSchema).min(1).max(6).optional(),
});

profileRouter.patch(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const patch = parse(patchProfileSchema, req.body);
    const eligibilityChanged =
      patch.dateOfBirth !== undefined ||
      patch.gender !== undefined ||
      patch.sexualOrientation !== undefined ||
      patch.relationshipGoal !== undefined ||
      patch.location !== undefined ||
      patch.preferences !== undefined;

    await withTransaction(async (client) => {
      if (eligibilityChanged) {
        // Serialize against reaction writes, which also rescore this user's
        // pair matrix. Otherwise a concurrent rescore could commit stale gates.
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      }

      const userSets: string[] = [];
      const userValues: unknown[] = [];

      /**
       * Column names are literals written here; only ever values from the
       * request body go through `push`, so nothing untrusted reaches the SQL as
       * anything but a parameter.
       */
      const set = (column: string, value: unknown): void => {
        userValues.push(value);
        userSets.push(`${column} = $${userValues.length}`);
      };

      if (patch.name !== undefined) set('name', patch.name);
      if (patch.dateOfBirth !== undefined) set('date_of_birth', patch.dateOfBirth);
      if (patch.gender !== undefined) set('gender', patch.gender);
      if (patch.sexualOrientation !== undefined) set('sexual_orientation', patch.sexualOrientation);
      if (patch.relationshipGoal !== undefined) set('relationship_goal', patch.relationshipGoal);
      if (patch.bio !== undefined) set('bio', patch.bio);

      if (patch.location !== undefined) {
        set('city', patch.location.city);
        set('country', patch.location.country);
        set('latitude', patch.location.latitude);
        set('longitude', patch.location.longitude);
      }

      if (userSets.length > 0) {
        await client.query(
          `UPDATE users
              SET ${userSets.join(', ')}, updated_at = now()
            WHERE id = $${userValues.length + 1}`,
          [...userValues, userId]
        );
      }

      if (patch.preferences !== undefined) {
        await upsertPreferences(client, userId, patch.preferences);
      }

      if (patch.photos !== undefined) {
        await replacePhotos(client, userId, patch.photos);
      }

      if (eligibilityChanged) {
        await rescoreForViewer(client, userId, eligibilitySql({ excludeSwiped: false }));
      }
    });

    send(res, await getUserById(userId));
  })
);

/**
 * Upsert rather than UPDATE, because a profile registered before preferences
 * were collected has no row at all -- the mock let `preferences` be absent and
 * filled in defaults at read time, and `toUser` still does.
 */
async function upsertPreferences(
  client: PoolClient,
  userId: string,
  p: {
    ageRange: { min: number; max: number };
    distanceMode: 'nearby' | 'global';
    maxDistance: number;
    genders: string[];
    relationshipGoals: string[];
  }
): Promise<void> {
  const columns = [
    'age_min',
    'age_max',
    'distance_mode',
    'max_distance',
    'genders',
    'relationship_goals',
  ];
  const values: unknown[] = [
    p.ageRange.min,
    p.ageRange.max,
    p.distanceMode,
    p.maxDistance,
    p.genders,
    p.relationshipGoals,
  ];

  const assignments = columns.map((column, i) => `${column} = $${i + 2}`).join(', ');

  await client.query(
    `INSERT INTO user_preferences (user_id, ${columns.join(', ')})
     VALUES ($1, ${values.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${assignments}`,
    [userId, ...values]
  );
}

/**
 * Verification status.
 *
 * Returns the current user's verification status based on their latest submission.
 * If no submission exists, returns 'unverified'.
 */
profileRouter.get(
  '/verification',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);

    // Get the latest submission for this user
    const { rows } = await pool.query<{
      verification_status: VerificationStatus['status'];
      rejection_reason: string | null;
      submitted_at: Date | null;
      reviewed_at: Date | null;
    }>(
      `SELECT u.verification_status,
              vs.rejection_reason,
              vs.submitted_at,
              vs.reviewed_at
         FROM users u
         LEFT JOIN LATERAL (
           SELECT rejection_reason, submitted_at, reviewed_at
             FROM verification_submissions
            WHERE user_id = u.id
            ORDER BY submitted_at DESC
            LIMIT 1
         ) vs ON true
        WHERE u.id = $1`,
      [userId]
    );

    const submission = rows[0];
    send(res, {
      status: submission?.verification_status ?? 'unverified',
      submittedAt: submission?.submitted_at?.toISOString(),
      reviewedAt: submission?.reviewed_at?.toISOString(),
      ...(submission?.rejection_reason ? { rejectionReason: submission.rejection_reason } : {}),
    });
  })
);

const verificationSubmitSchema = z
  .object({
    imageData: z
      .string()
      .min(32, 'Image data is required')
      .max(2_200_000, 'Image must be smaller than 1.6 MB')
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a valid image'),
    imageMime: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
  })
  .superRefine(({ imageData, imageMime }, context) => {
    if (!imageData.startsWith(`data:${imageMime};base64,`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['imageMime'],
        message: 'Image type does not match the uploaded data',
      });
    }
  });

/**
 * Submit a verification photo for admin review.
 *
 * Creates a pending submission. Does NOT award the badge immediately.
 * The badge is only awarded after an admin accepts the submission.
 */
profileRouter.post(
  '/verification',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = parse(verificationSubmitSchema, req.body);

    const submittedAt = await withTransaction(async (client) => {
      const { rows: users } = await client.query<{
        verification_status: VerificationStatus['status'];
        is_verified: boolean;
      }>('SELECT verification_status, is_verified FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const user = users[0];
      if (!user) throw ApiError.notFound('Profile not found');
      if (user.is_verified || user.verification_status === 'verified') {
        throw ApiError.conflict('This account is already verified');
      }
      if (user.verification_status === 'pending') {
        throw ApiError.conflict('A verification submission is already pending');
      }

      const { rows } = await client.query<{ submitted_at: Date }>(
        `INSERT INTO verification_submissions (user_id, image_data, image_mime, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING submitted_at`,
        [userId, body.imageData, body.imageMime]
      );

      await client.query(
        `UPDATE users
            SET is_verified = false, verification_status = 'pending', updated_at = now()
          WHERE id = $1`,
        [userId]
      );
      return rows[0]?.submitted_at ?? new Date();
    });

    send(
      res,
      {
        status: 'pending',
        submittedAt: submittedAt.toISOString(),
      },
      201
    );
  })
);

/**
 * Photos are replaced wholesale rather than diffed.
 *
 * Six rows: one delete and one insert, inside the caller's transaction. A diff
 * would have to work out which photo became primary, which moved, and which
 * disappeared, and every intermediate state would have to satisfy
 * `photos_one_primary_per_user` -- which means clearing the old primary before
 * setting the new one, or the partial unique index rejects the insert partway
 * through. Replacing the set sidesteps that.
 */
async function replacePhotos(client: PoolClient, userId: string, photos: Photo[]): Promise<void> {
  await client.query('DELETE FROM photos WHERE user_id = $1', [userId]);

  for (const photo of photos) {
    await client.query(
      'INSERT INTO photos (user_id, url, is_primary, position) VALUES ($1, $2, $3, $4)',
      [userId, photo.url, photo.isPrimary, photo.order]
    );
  }
}
