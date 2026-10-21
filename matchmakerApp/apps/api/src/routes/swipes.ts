import { Router } from 'express';
import type { MatchedUserSummary, MatchPair, SwipeResponse } from '@match-makers/shared';
import { z } from 'zod';
import { currentUserId, requireAuth } from '@/auth';
import { withTransaction, type Queryable } from '@/db';
import { toPhoto, type PhotoRow } from '@/db/rows';
import { ApiError } from '@/errors';
import { asyncHandler, parse, send } from '@/http';

export const swipesRouter = Router();

const swipeSchema = z.object({
  targetUserId: z.string().uuid('targetUserId must be a user id'),
  action: z.enum(['like', 'pass', 'super_like']),
});

/**
 * Record a swipe, and create a match if it was mutual.
 *
 * `ON CONFLICT (actor_id, target_user_id) DO UPDATE` is what makes this an
 * upsert. The unique index is the `swipedUserIds` Set the mock maintained in
 * memory, and naming it as the conflict target is how the database is told
 * which row to replace -- so re-swiping updates in place instead of growing a
 * second opinion about the same person.
 *
 * `super_like` does not match on its own. It is a request to be matched rather
 * than a match, and the only rule is that two `like`s make one.
 *
 * This also retires `Math.random() < 0.35` from `services/feed.ts`, which is
 * the one line of that file worth being glad to see go.
 */
swipesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const actorId = currentUserId(req);
    const body = parse(swipeSchema, req.body);

    if (body.targetUserId === actorId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'You cannot swipe on yourself', {
        targetUserId: 'Pick somebody else',
      });
    }

    const outcome = await withTransaction(async (client) => {
      const target = await client.query('SELECT id FROM users WHERE id = $1', [body.targetUserId]);
      if (target.rowCount === 0) throw ApiError.notFound('That profile no longer exists');

      const swipe = await client.query<{ id: string }>(
        `INSERT INTO swipes (actor_id, target_user_id, action)
              VALUES ($1, $2, $3)
         ON CONFLICT (actor_id, target_user_id)
         DO UPDATE SET action = EXCLUDED.action, created_at = now()
         RETURNING id`,
        [actorId, body.targetUserId, body.action]
      );

      const swipeId = swipe.rows[0]?.id;
      if (!swipeId) throw new Error('INSERT ... RETURNING id produced no row');

      const reciprocal =
        body.action === 'like' &&
        (
          await client.query(
            `SELECT 1 FROM swipes
            WHERE actor_id = $1 AND target_user_id = $2 AND action = 'like'`,
            [body.targetUserId, actorId]
          )
        ).rowCount !== 0;

      if (!reciprocal) return { swipeId, isMatch: false, match: null };

      return {
        swipeId,
        isMatch: true,
        match: await createMatch(client, actorId, body.targetUserId),
      };
    });

    const response: SwipeResponse = {
      swipeId: outcome.swipeId,
      isMatch: outcome.isMatch,
      ...(outcome.match ? { match: outcome.match } : {}),
    };

    send(res, response, outcome.isMatch ? 201 : 200);
  })
);

/**
 * Create the match between two people, or return the existing one.
 *
 * `least()`/`greatest()` order the pair into the canonical form the schema's
 * `CHECK (user_a_id < user_b_id)` demands. Doing it in SQL means no caller can
 * get it wrong by swapping the arguments -- and because it is derived rather
 * than passed, it cannot be forged past the check either.
 *
 * The `$1::uuid` casts are load-bearing and look redundant next to the column
 * type. Without them `least` sees two untyped parameters, returns `text`, and
 * Postgres rejects the insert with "column user_a_id is of type uuid but
 * expression is of type text". `pg` sends parameters untyped by design and lets
 * the server infer, and inference fails here because the *result* type of
 * `least` is not the type of its arguments when the arguments are unknown.
 *
 * `DO UPDATE SET created_at = matches.created_at` is a no-op assignment chosen
 * so a second swipe cannot quietly re-date the match. It reads as noise but it
 * is what makes this idempotent: `DO NOTHING` would skip the RETURNING row and
 * lose the id of a match that already existed.
 */
export async function createMatch(
  client: Queryable,
  a: string,
  b: string
): Promise<MatchPair | null> {
  const inserted = await client.query<{ id: string; created_at: Date }>(
    `INSERT INTO matches (user_a_id, user_b_id)
          VALUES (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))
     ON CONFLICT (user_a_id, user_b_id)
     DO UPDATE SET created_at = matches.created_at
     RETURNING id, created_at`,
    [a, b]
  );

  const row = inserted.rows[0];
  if (!row) return null;

  // `a` is the swiper, so `b` is the person on the card. The ids are uuids and
  // cannot be equal -- the route rejects that case -- but the ordering here is
  // driven by the call order, not by which is smaller, which is what
  // `least`/`greatest` did to the row.
  return {
    id: row.id,
    matchedAt: row.created_at.toISOString(),
    user: await loadMatchSummary(client, b),
  };
}

/**
 * The `MatchedUserSummary` a match card or conversation row shows.
 *
 * The photo sub-select is `ORDER BY is_primary DESC, position LIMIT 1`: prefer
 * the photo flagged primary, and fall back to the earliest, so a profile with
 * no primary set still renders a face. `/matches` needs exactly this shape, so
 * it is shared rather than written twice and drifted.
 */
export async function loadMatchSummary(
  client: Queryable,
  userId: string
): Promise<MatchedUserSummary> {
  const { rows } = await client.query<{
    name: string;
    is_verified: boolean;
    photo: PhotoRow | null;
  }>(
    `SELECT u.name, u.is_verified,
            (SELECT json_build_object(
                      'id', ph.id, 'user_id', ph.user_id, 'url', ph.url,
                      'is_primary', ph.is_primary, 'position', ph.position
                    )
               FROM photos ph
              WHERE ph.user_id = u.id
              ORDER BY ph.is_primary DESC, ph.position
              LIMIT 1
            ) AS photo
       FROM users u
      WHERE u.id = $1`,
    [userId]
  );

  const row = rows[0];

  return {
    id: userId,
    name: row?.name ?? 'Someone',
    primaryPhotoUrl: row?.photo ? toPhoto(row.photo).url : null,
    isVerified: row?.is_verified ?? false,
  };
}
