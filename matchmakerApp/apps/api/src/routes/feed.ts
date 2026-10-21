import { Router } from 'express';
import type { User } from '@match-makers/shared';
import { z } from 'zod';
import { currentUserId, requireAuth } from '@/auth';
import { eligibilitySql } from '@/eligibility';
import { pool } from '@/db';
import { toPhoto, type PhotoRow, type UserRow } from '@/db/rows';
import { asyncHandler, parse, send } from '@/http';
import { bandFor, describeAffinity, PHOTOS_FOR_FULL_TASTE } from '@/matching';

export const feedRouter = Router();

/**
 * The deck's shape, as the app's `FeedPage` in `apps/mobile/src/types`.
 *
 * Transcribed rather than imported, for the same reason the app's view types are
 * not in `@match-makers/shared`: this is a presentation shape with a `band` on
 * it, and the shared package is the domain model.
 */
interface FeedPage {
  items: Array<{ user: User; compatibility: CompatibilityBreakdown; band: string }>;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  blockedReason: string | null;
  needsTaste: boolean;
}

interface CompatibilityBreakdown {
  score: number;
  sharedGoals: boolean;
  mutualOrientation: boolean;
  tasteAffinity: number;
  coLikedPosts: number;
  sharedTags: string[];
  reason: string | null;
}

const feedQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(10),
});

/**
 * A candidate row, plus the stored score when there is one.
 *
 * `score` comes from `match_scores`, the ranking the rescore computed and
 * stored. Reading it is a range scan on `(viewer_id, score DESC)` -- the
 * alternative was computing the whole pool's affinity on every request, which
 * measured at 569ms over 400,000 rows.
 *
 * A candidate with no stored score falls back to the stated facts alone, which
 * is the honest answer for somebody nobody has rescored yet: their goal, their
 * orientation, whether they are verified. Twenty points at most.
 */
interface CandidateRow extends UserRow {
  distance_km: number | null;
  total_count: string;
  photos: PhotoRow[] | null;
  stored_score: number | null;
  stored_affinity: number | null;
  stored_co_liked: number | null;
  stored_tags: string[] | null;
  stored_band: string | null;
  goal_affinity: number;
  shared_goals: boolean;
  mutual_orientation: boolean;
}

/**
 * The deck.
 *
 * `utils/eligibility.ts` builds a `mutualGate` and runs it in both directions
 * over every user in the database; that gate lives in SQL now, and the ranking
 * is a stored result rather than something computed per request.
 *
 * Both directions are load-bearing. The caller's filters decide what they are
 * shown, but a candidate whose own filters exclude the caller is someone who
 * will never see them back. `TasteSummary.closest` carries a note about having
 * got this wrong once: it used to name as "closest" people the deck would never
 * show.
 */
feedRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);
    const { page, pageSize } = parse(feedQuerySchema, req.query);

    const { rows } = await pool.query<CandidateRow>(
      `
      WITH eligible AS (
        ${eligibilitySql()}
      ),
      viewer AS (
        SELECT relationship_goal, sexual_orientation FROM users WHERE id = $1
      ),
      scored AS (
        SELECT
          eligible.*,
          ms.score           AS stored_score,
          ms.taste_affinity  AS stored_affinity,
          ms.co_liked_count  AS stored_co_liked,
          ms.shared_tags     AS stored_tags,
          ms.band            AS stored_band,
          -- The stated facts, so a candidate nobody has rescored still has a
          -- score rather than a blank card.
          GREATEST(0, 1 - abs(
            CASE viewer.relationship_goal
              WHEN 'long_term' THEN 3 WHEN 'short_term' THEN 2 WHEN 'casual' THEN 1
              WHEN 'friendship' THEN 1 WHEN 'not_sure' THEN 0 END
            - CASE eligible.relationship_goal
              WHEN 'long_term' THEN 3 WHEN 'short_term' THEN 2 WHEN 'casual' THEN 1
              WHEN 'friendship' THEN 1 WHEN 'not_sure' THEN 0 END
          )::float / 3) AS goal_affinity,
          (viewer.relationship_goal = eligible.relationship_goal) AS shared_goals,
          (viewer.sexual_orientation = eligible.sexual_orientation) AS mutual_orientation,
          round(
            10 * GREATEST(0, 1 - abs(
              CASE viewer.relationship_goal
                WHEN 'long_term' THEN 3 WHEN 'short_term' THEN 2 WHEN 'casual' THEN 1
                WHEN 'friendship' THEN 1 WHEN 'not_sure' THEN 0 END
              - CASE eligible.relationship_goal
                WHEN 'long_term' THEN 3 WHEN 'short_term' THEN 2 WHEN 'casual' THEN 1
                WHEN 'friendship' THEN 1 WHEN 'not_sure' THEN 0 END
            )::float / 3)
            + 6 * (viewer.sexual_orientation = eligible.sexual_orientation)::int
            + 4 * eligible.is_verified::int
          ) AS fallback_score
        FROM eligible
        CROSS JOIN viewer
        LEFT JOIN match_scores ms
          ON ms.viewer_id = $1 AND ms.candidate_id = eligible.id
      )
      SELECT
        scored.*,
        -- The stored score when there is one, the stated facts otherwise.
        COALESCE(stored_score, fallback_score) AS score
      FROM scored
      ORDER BY score DESC, created_at DESC, id
      LIMIT $2 OFFSET $3
      `,
      [viewerId, pageSize, (page - 1) * pageSize]
    );

    // `COUNT(*) OVER ()` runs over the filtered set before LIMIT, so `total` is
    // the real number of matches rather than "however many came back". It is
    // null on an empty page, hence the `?? 0`.
    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;

    // The viewer's own like count, for the provisional flag. Below ten answers
    // the number genuinely is provisional -- every pair looks alike because there
    // is almost nothing to tell them apart on.
    const { rows: likeRows } = await pool.query<{ likes: string }>(
      `SELECT count(*)::text AS likes FROM post_reactions
        WHERE user_id = $1 AND action = 'like'`,
      [viewerId]
    );
    const viewerLikes = Number(likeRows[0]?.likes ?? 0);

    const result: FeedPage = {
      items: rows.map((row) => ({
        user: toCandidate(row),
        compatibility: {
          score: effectiveScore(row),
          sharedGoals: row.shared_goals,
          mutualOrientation: row.mutual_orientation,
          tasteAffinity: row.stored_affinity ?? 0,
          coLikedPosts: row.stored_co_liked ?? 0,
          sharedTags: row.stored_tags ?? [],
          reason: describeAffinity(row.stored_co_liked ?? 0, row.stored_tags ?? []),
        },
        band: row.stored_band ?? bandFor(effectiveScore(row)),
      })),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
      blockedReason: total === 0 ? await explainEmptyDeck(viewerId) : null,
      needsTaste: viewerLikes < PHOTOS_FOR_FULL_TASTE,
    };

    send(res, result);
  })
);

/**
 * The score to show for a candidate.
 *
 * The stored one when the rescore has run, the stated facts otherwise. Both are
 * out of 100 and capped there, the same as the client's `scoreCompatibility`.
 */
function effectiveScore(row: CandidateRow): number {
  if (row.stored_score !== null) return row.stored_score;

  const stated =
    10 * row.goal_affinity + 6 * (row.mutual_orientation ? 1 : 0) + 4 * (row.is_verified ? 1 : 0);
  return Math.round(Math.min(100, stated));
}

/**
 * Candidate row -> `User`.
 *
 * Preferences are placeholder values rather than the candidate's real ones. The
 * deck needs enough of a candidate to render a card and score them against the
 * viewer's preferences; sending their own filters back would leak what people
 * they are willing to see for no benefit, and there is no caller that needs it.
 */
function toCandidate(row: CandidateRow): User {
  return {
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
    preferences: {
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
}

/**
 * Why an empty deck is empty, in the app's vocabulary.
 *
 * The app's `summariseBlockers` in `utils/eligibility.ts` owns this list, and
 * `FeedPage.blockedReason` says the server can answer it better than the client
 * can from one page. It cannot yet -- that needs the same per-candidate
 * walk-over that the scoring does. Until it can, this names the one cause worth
 * distinguishing: nobody else being signed up at all.
 */
async function explainEmptyDeck(viewerId: string): Promise<string | null> {
  const { rows } = await pool.query<{ others: string }>(
    `SELECT count(*)::text AS others FROM users WHERE id <> $1`,
    [viewerId]
  );

  if (Number(rows[0]?.others ?? 0) === 0) {
    return 'Nobody else has signed up yet. Add a few more profiles and this deck will fill up.';
  }

  return 'Nobody here matches your preferences right now. Widening your age range, distance or goals will help.';
}
