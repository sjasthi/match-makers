import { Router } from 'express';
import type { User } from '@match-makers/shared';
import { z } from 'zod';
import { currentUserId, requireAuth } from '@/auth';
import { eligibilitySql } from '@/eligibility';
import { pool } from '@/db';
import { toPhoto, type PhotoRow, type UserRow } from '@/db/rows';
import { asyncHandler, parse, send } from '@/http';
import {
  bandFor,
  describeAffinity,
  PHOTOS_FOR_FULL_TASTE,
  DECK_ENTER_SCORE,
  DECK_EXIT_SCORE,
} from '@/matching';

export const feedRouter = Router();

/**
 * The deck's shape, as the app's `FeedPage` in `apps/mobile/src/types`.
 *
 * Transcribed rather than imported, for the same reason the app's view types are
 * not in `@match-makers/shared`: this is a presentation shape with a `band` on
 * it, and the shared package is the domain model.
 */
interface FeedPage {
  items: Array<{ user: User; compatibility: CompatibilityBreakdown; band?: string }>;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  blockedReason: string | null;
  needsTaste: boolean;
}

interface CompatibilityBreakdown {
  score: number | null;
  sharedGoals: boolean;
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
 * Deck admission has hysteresis: a pair enters at `DECK_ENTER_SCORE` and, once
 * revealed, stays until its score falls below `DECK_EXIT_SCORE`. Candidates
 * with no score never enter the Likes deck.
 */
interface CandidateRow extends UserRow {
  distance_km: number | null;
  total_count: string;
  /** Set by the outer query: strong-match count before paging. */
  strong_total: string;
  photos: PhotoRow[] | null;
  score: number | null;
  stored_score: number | null;
  stored_affinity: number | null;
  stored_co_liked: number | null;
  stored_tags: string[] | null;
  stored_band: string | null;
  /** When the pair first reached the deck's entry score, if it ever did. */
  stored_revealed_at: Date | null;
  shared_goals: boolean;
}

/**
 * The deck.
 *
 * `utils/eligibility.ts` builds a `mutualGate` and runs it in both directions
 * over every user in the database; that gate lives in SQL now, and the ranking
 * is a stored result rather than something computed per request.
 *
 * Deck admission is hysteretic: a pair enters at `DECK_ENTER_SCORE` and, once
 * revealed, stays until its score falls below `DECK_EXIT_SCORE`. The reveal is
 * a property of the pair, so both people see the same behaviour. A post
 * deletion refreshes the score cache before this query, so a stale high
 * percentage cannot keep a candidate in the deck after its evidence is gone.
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
        SELECT relationship_goal FROM users WHERE id = $1
      ),
      scored AS (
        SELECT
          eligible.*,
          ms.score           AS stored_score,
          ms.taste_affinity  AS stored_affinity,
          ms.co_liked_count  AS stored_co_liked,
          ms.shared_tags     AS stored_tags,
          ms.band            AS stored_band,
          ms.revealed_at     AS stored_revealed_at,
          (viewer.relationship_goal = eligible.relationship_goal) AS shared_goals
        FROM eligible
        CROSS JOIN viewer
        LEFT JOIN match_scores ms
          ON ms.viewer_id = $1 AND ms.candidate_id = eligible.id
      ),
      strong_matches AS (
        SELECT
          scored.*,
          stored_score AS score
        FROM scored
        WHERE stored_score IS NOT NULL
          AND (
            stored_score >= ${DECK_ENTER_SCORE}
            OR (stored_revealed_at IS NOT NULL AND stored_score >= ${DECK_EXIT_SCORE})
          )
      )
      SELECT
        strong_matches.*,
        -- Count before LIMIT so paging knows the full strong-match set.
        COUNT(*) OVER ()::text AS strong_total
      FROM strong_matches
      ORDER BY score DESC NULLS LAST, created_at DESC, id
      LIMIT $2 OFFSET $3
      `,
      [viewerId, pageSize, (page - 1) * pageSize]
    );

    // `COUNT(*) OVER ()` runs over the strong-match set before LIMIT, so `total`
    // is the real number of cards rather than "however many came back".
    // It is null on an empty page, hence the `?? 0`.
    const total = rows.length > 0 ? Number(rows[0]?.strong_total ?? 0) : 0;

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
          score: row.score,
          sharedGoals: row.shared_goals,
          tasteAffinity: Number(row.stored_affinity ?? 0),
          coLikedPosts: row.score === null ? 0 : (row.stored_co_liked ?? 0),
          sharedTags: row.score === null ? [] : (row.stored_tags ?? []),
          reason:
            row.score === null
              ? null
              : describeAffinity(row.stored_co_liked ?? 0, row.stored_tags ?? []),
        },
        ...(row.score !== null ? { band: row.stored_band ?? bandFor(row.score) } : {}),
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

  // Check if there are eligible profiles but none with 80%+ score
  const { rows: eligibleRows } = await pool.query<{ count: string }>(
    `WITH eligible AS (${eligibilitySql()}) SELECT count(*)::text AS count FROM eligible`,
    [viewerId]
  );
  const eligibleCount = Number(eligibleRows[0]?.count ?? 0);

  if (eligibleCount > 0) {
    return 'No strong matches yet — like more photos to find them.';
  }

  return 'Nobody here matches your preferences right now. Widening your age range, distance or goals will help.';
}
