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
import { pool, withTransaction } from '@/db';
import { getUserById } from '@/db/users';
import { asyncHandler, parse, send } from '@/http';

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

    await withTransaction(async (client) => {
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
 * `getVerificationStatus` calls this on both auth adapters and it did not exist,
 * so opening the verification screen in HTTP mode was a 404. It reports the
 * `users.verification_status` column, which only ever holds `unverified` --
 * FP1's ID/puzzle/biometric flow is not built, and the column is there so that
 * work has something to write to.
 */
profileRouter.get(
  '/verification',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserById(currentUserId(req));
    send(res, { status: verificationStatusFor(user) });
  })
);

const verificationSchema = z.object({
  method: z.enum(['document', 'selfie', 'phone', 'email']),
});

/**
 * Record a verification submission.
 *
 * The mock marks you verified immediately so the rest of the app can be
 * exercised; this does the same, for the same reason, and says so in the README
 * rather than pretending a check happened. `status` is `verified` and the badge
 * is set, but no document was checked and `method` is only recorded as what
 * somebody said they would do.
 */
profileRouter.post(
  '/verification',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = parse(verificationSchema, req.body);

    await pool.query(
      `UPDATE users SET is_verified = true, verification_status = 'verified', updated_at = now()
        WHERE id = $1`,
      [userId]
    );

    void body;
    send(res, { status: 'verified', method: body.method });
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

/**
 * Derive the reported status from the badge.
 *
 * `users.verification_status` is the stored truth and is not yet selectable by
 * anything, so the badge and the column always agree and this is a read of the
 * column with a fallback. Kept as a function so that when a real submission
 * flow starts writing `pending`/`rejected`, there is one place to change.
 */
function verificationStatusFor(user: { isVerified: boolean }): VerificationStatus['status'] {
  return user.isVerified ? 'verified' : 'unverified';
}
