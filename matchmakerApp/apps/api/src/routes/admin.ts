import { Router } from 'express';
import type { User } from '@match-makers/shared';
import { z } from 'zod';
import { pool, withTransaction } from '@/db';
import { toPhoto, toPost, type PhotoRow, type PostRow } from '@/db/rows';
import { ApiError } from '@/errors';
import { asyncHandler, parse, send } from '@/http';
import { requireAdmin } from '@/admin';
import { currentUserId, requireAuth } from '@/auth';

export const adminRouter = Router();

/**
 * Administration.
 *
 * Every route below requires `requireAdmin`, and the guard is applied once here
 * rather than per route so a new route cannot be added without it.
 *
 * Note what is *not* here: nothing that grants admin. The flag is set only by
 * `npm run admin -- grant`, which needs database credentials. A route that can
 * hand out admin would be reachable by anyone who could authenticate.
 */

/*
 * Wrapped in `asyncHandler` because `requireAdmin` is `async` and Express 4 does
 * not catch a rejected promise from middleware.
 *
 * Without the wrapper, `currentUserId()` throwing `UNAUTHORIZED` inside it became
 * an unhandled rejection, which Node treats as fatal -- so the first anonymous
 * request to any `/admin` path killed the entire server. Found it by watching the
 * process die rather than the request fail, which is the worst way to find out.
 * The rule is already written on `asyncHandler`; this is the second time not
 * applying it has cost time.
 */
/*
 * `requireAuth` first, and it is not optional: `requireAdmin` reads
 * `req.userId`, which only `requireAuth` sets. Without it every caller --
 * including a signed-in non-admin -- looked unauthenticated and got a 401
 * instead of the 403 that would have told them the request was well-formed and
 * they simply lack the role.
 *
 * The two are applied together, once, rather than per route so a route added
 * later cannot skip either.
 */
adminRouter.use(requireAuth, asyncHandler(requireAdmin));

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  date_of_birth: string;
  gender: User['gender'];
  sexual_orientation: User['sexualOrientation'];
  relationship_goal: User['relationshipGoal'];
  bio: string;
  latitude: number | null;
  longitude: number | null;
  city: string;
  country: string;
  is_verified: boolean;
  is_admin: boolean;
  created_at: Date;
  updated_at: Date;
  photos: PhotoRow[];
  prefs_user_id: string | null;
  age_min: number | null;
  age_max: number | null;
  distance_mode: User['preferences']['distanceMode'] | null;
  max_distance: number | null;
  genders: User['preferences']['genders'] | null;
  relationship_goals: User['preferences']['relationshipGoals'] | null;
  match_count: string;
  answered_photos: string;
}

/**
 * `AdminUserSummary` minus the fields the app derives itself.
 *
 * `age`, `isDemo` and `isProfileComplete` are deliberately **not** computed
 * here. They live in `utils/mockData.ts` and `services/profile.ts` in the mobile
 * app, and reimplementing them on the server would mean two definitions of "is
 * this profile finished" that could disagree -- and the whole point of that flag
 * is that it gates the feed. The app assembles the summary with the same
 * `toSummary()` it already uses for the mock branch.
 */
interface AdminUserRecord {
  user: User;
  matchCount: number;
  answeredPhotos: number;
}

function toRecord(row: AdminUserRow): AdminUserRecord {
  const hasPreferences = row.prefs_user_id !== null;

  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    sexualOrientation: row.sexual_orientation,
    relationshipGoal: row.relationship_goal,
    bio: row.bio,
    photos: (row.photos ?? []).map(toPhoto),
    location: {
      latitude: row.latitude ?? 0,
      longitude: row.longitude ?? 0,
      city: row.city,
      country: row.country,
    },
    preferences: hasPreferences
      ? {
          ageRange: { min: row.age_min as number, max: row.age_max as number },
          distanceMode: row.distance_mode as User['preferences']['distanceMode'],
          maxDistance: row.max_distance as number,
          genders: row.genders as User['preferences']['genders'],
          relationshipGoals: row.relationship_goals as User['preferences']['relationshipGoals'],
        }
      : {
          ageRange: { min: 24, max: 38 },
          distanceMode: 'nearby',
          maxDistance: 50,
          genders: [],
          relationshipGoals: [],
        },
    isVerified: row.is_verified,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };

  return {
    user,
    matchCount: Number(row.match_count),
    answeredPhotos: Number(row.answered_photos),
  };
}

/**
 * Every account, newest first.
 *
 * One statement. The photos are a `json_agg` sub-select and the two counts are
 * `LATERAL` joins, because the obvious alternative is one query for the users
 * then two more per user -- and an admin list is exactly the screen where that
 * shows up as a spinner.
 *
 * Newest first because that is how you find the account you just registered.
 * `id` breaks ties so accounts created in the same millisecond do not shuffle
 * between renders.
 */
adminRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<AdminUserRow>(
      `SELECT
         u.id, u.email, u.name, u.date_of_birth, u.gender, u.sexual_orientation,
         u.relationship_goal, u.bio, u.latitude, u.longitude, u.city, u.country,
         u.is_verified, u.is_admin, u.created_at, u.updated_at,
         COALESCE(
           (SELECT json_agg(json_build_object(
                      'id', ph.id, 'user_id', ph.user_id, 'url', ph.url,
                      'is_primary', ph.is_primary, 'position', ph.position
                    ) ORDER BY ph.position)
              FROM photos ph WHERE ph.user_id = u.id),
           '[]'::json
         ) AS photos,
         p.user_id AS prefs_user_id,
         p.age_min, p.age_max, p.distance_mode, p.max_distance,
         p.genders, p.relationship_goals,
         (SELECT count(*) FROM matches m
           WHERE m.user_a_id = u.id OR m.user_b_id = u.id)::text AS match_count,
         (SELECT count(*) FROM post_reactions r WHERE r.user_id = u.id)::text AS answered_photos
       FROM users u
       LEFT JOIN user_preferences p ON p.user_id = u.id
       ORDER BY u.created_at DESC, u.id DESC`
    );

    send(res, rows.map(toRecord));
  })
);

const adminUserParams = z.object({ userId: z.string().uuid('userId must be a user id') });

adminRouter.get(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = parse(adminUserParams, req.params);
    const record = await findRecord(userId);
    if (!record) throw ApiError.notFound('No account with that id');
    send(res, record.user);
  })
);

async function findRecord(userId: string): Promise<AdminUserRecord | null> {
  const { rows } = await pool.query<AdminUserRow>(
    `SELECT
       u.id, u.email, u.name, u.date_of_birth, u.gender, u.sexual_orientation,
       u.relationship_goal, u.bio, u.latitude, u.longitude, u.city, u.country,
       u.is_verified, u.is_admin, u.created_at, u.updated_at,
       COALESCE(
         (SELECT json_agg(json_build_object(
                    'id', ph.id, 'user_id', ph.user_id, 'url', ph.url,
                    'is_primary', ph.is_primary, 'position', ph.position
                  ) ORDER BY ph.position)
            FROM photos ph WHERE ph.user_id = u.id),
         '[]'::json
       ) AS photos,
       p.user_id AS prefs_user_id,
       p.age_min, p.age_max, p.distance_mode, p.max_distance,
       p.genders, p.relationship_goals,
       (SELECT count(*) FROM matches m
         WHERE m.user_a_id = u.id OR m.user_b_id = u.id)::text AS match_count,
       (SELECT count(*) FROM post_reactions r WHERE r.user_id = u.id)::text AS answered_photos
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  const row = rows[0];
  return row ? toRecord(row) : null;
}

interface AdminPostRow extends PostRow {
  likes: string;
  dislikes: string;
}

/**
 * The photo library with its reaction counts.
 *
 * The counts are what make this a curation tool rather than a file browser: a
 * photo nobody has answered and one that thirty people liked are both sitting in
 * the feed, and only one of them is doing anything.
 *
 * One `LEFT JOIN LATERAL` over `post_reactions` rather than the aggregate over
 * the whole table the mock does, so the cost scales with what is on screen.
 *
 * The optional `tag` filter is the one query in the product that wants "every
 * photo carrying this tag", and it is the reason `posts.tags` has a `GIN`
 * index. The operator is `@>` -- array containment -- which is what the `GIN`
 * `array_ops` opclass indexes. Measured against a 20,000-photo library the
 * planner uses it and the lookup is a few milliseconds; without the index the
 * same query reads every row and un nests every tag on it.
 *
 * The containment operator is `a @> b` meaning "a contains b", so it is the
 * photo's tags that must contain the one being looked for. The order is not
 * interchangeable and the wrong way round silently returns everything.
 */
adminRouter.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const { tag } = parse(adminPostsQuery, req.query);

    const { rows } = await pool.query<AdminPostRow>(
      `SELECT
         p.id, p.image_uri, p.thumb_uri, p.width, p.height, p.tags, p.created_at,
         COALESCE(counts.likes, 0)::text    AS likes,
         COALESCE(counts.dislikes, 0)::text AS dislikes
       FROM posts p
       LEFT JOIN LATERAL (
         SELECT
           count(*) FILTER (WHERE action = 'like')    AS likes,
           count(*) FILTER (WHERE action = 'dislike') AS dislikes
           FROM post_reactions r
          WHERE r.post_id = p.id
       ) AS counts ON true
       ${tag ? 'WHERE p.tags @> ARRAY[$1]::text[]' : ''}
       ORDER BY p.created_at DESC, p.id DESC`,
      tag ? [tag] : []
    );

    send(
      res,
      rows.map((row) => ({
        post: toPost(row),
        likes: Number(row.likes),
        dislikes: Number(row.dislikes),
      }))
    );
  })
);

/**
 * The optional tag filter on the library.
 *
 * A tag is a single word in a controlled vocabulary, so the length is bounded
 * and the character set is not worth policing: `postTagListSchema` does the
 * folding and it is the same folding applied on the way in, so `Dogs` and `dog`
 * are one tag by the time either side sees it.
 */
const adminPostsQuery = z.object({
  tag: z.string().trim().min(1).max(64).optional(),
});

/**
 * Every tag in the library with how many posts carry it.
 *
 * The `unnest` in a lateral keeps the aggregation to the rows that actually
 * have tags. This is a full scan of the library rather than an index lookup,
 * because the answer is every tag and every count -- there is no single tag to
 * look up, so the `GIN` index has nothing to do here. The index earns its place
 * on the *filter* below.
 */
adminRouter.get(
  '/tags',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<{ tag: string; count: string }>(
      `SELECT tag, count(*)::text AS count
         FROM posts p
         CROSS JOIN LATERAL unnest(p.tags) AS tag
        GROUP BY tag
        ORDER BY count(*) DESC, tag ASC`
    );

    send(
      res,
      rows.map((row) => ({ tag: row.tag, count: Number(row.count) }))
    );
  })
);

/* -------------------------------------------------------------------------- */
/* Verification review                                                        */
/* -------------------------------------------------------------------------- */

interface AdminVerificationRow {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  user_is_verified: boolean;
  user_verification_status: string;
  image_data: string;
  image_mime: string;
  status: string;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
}

/**
 * All pending verification submissions, newest first.
 */
adminRouter.get(
  '/verifications/pending',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<AdminVerificationRow>(
      `SELECT
         vs.id, vs.user_id, vs.image_data, vs.image_mime, vs.status,
         vs.submitted_at, vs.reviewed_at, vs.reviewed_by, vs.rejection_reason,
         u.email AS user_email, u.name AS user_name,
         u.is_verified AS user_is_verified, u.verification_status AS user_verification_status
       FROM verification_submissions vs
       JOIN users u ON u.id = vs.user_id
       WHERE vs.status = 'pending'
       ORDER BY vs.submitted_at DESC`
    );

    send(
      res,
      rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email,
        userName: row.user_name,
        userIsVerified: row.user_is_verified,
        userVerificationStatus: row.user_verification_status,
        imageData: row.image_data,
        imageMime: row.image_mime,
        status: row.status,
        submittedAt: row.submitted_at.toISOString(),
        reviewedAt: row.reviewed_at?.toISOString(),
        reviewedBy: row.reviewed_by,
        rejectionReason: row.rejection_reason,
      }))
    );
  })
);

/**
 * Accept a pending verification submission.
 * Sets the user's is_verified = true and verification_status = 'verified'.
 */
const adminVerifyAcceptSchema = z.object({
  submissionId: z.string().uuid('submissionId must be a uuid'),
});

adminRouter.post(
  '/verifications/accept',
  asyncHandler(async (req, res) => {
    const adminUserId = currentUserId(req);
    const { submissionId } = parse(adminVerifyAcceptSchema, req.body);

    await withTransaction(async (client) => {
      // Get the submission
      const { rows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM verification_submissions WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [submissionId]
      );

      const submission = rows[0];
      if (!submission) throw ApiError.notFound('No pending submission with that id');

      // Update the submission to accepted
      await client.query(
        `UPDATE verification_submissions
            SET status = 'verified', reviewed_at = now(), reviewed_by = $1
          WHERE id = $2`,
        [adminUserId, submissionId]
      );

      // Update the user to verified
      await client.query(
        `UPDATE users
            SET is_verified = true, verification_status = 'verified', updated_at = now()
          WHERE id = $1`,
        [submission.user_id]
      );
    });

    send(res, { accepted: true });
  })
);

/**
 * Decline a pending verification submission.
 * Sets the submission status to 'rejected' with a reason.
 * User can resubmit afterwards.
 */
const adminVerifyDeclineSchema = z.object({
  submissionId: z.string().uuid('submissionId must be a uuid'),
  reason: z.string().min(1, 'Reason is required').max(500),
});

adminRouter.post(
  '/verifications/decline',
  asyncHandler(async (req, res) => {
    const adminUserId = currentUserId(req);
    const { submissionId, reason } = parse(adminVerifyDeclineSchema, req.body);

    await withTransaction(async (client) => {
      // Get the submission
      const { rows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM verification_submissions WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [submissionId]
      );

      const submission = rows[0];
      if (!submission) throw ApiError.notFound('No pending submission with that id');

      // Update the submission to rejected
      await client.query(
        `UPDATE verification_submissions
            SET status = 'rejected', reviewed_at = now(), reviewed_by = $1, rejection_reason = $2
          WHERE id = $3`,
        [adminUserId, reason, submissionId]
      );

      // A declined request remains visibly rejected and never grants the badge.
      await client.query(
        `UPDATE users
            SET is_verified = false, verification_status = 'rejected', updated_at = now()
          WHERE id = $1`,
        [submission.user_id]
      );
    });

    send(res, { declined: true });
  })
);
