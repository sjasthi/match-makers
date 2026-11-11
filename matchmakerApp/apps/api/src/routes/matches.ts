import { Router } from 'express';
import type { Message, MessageSummary, User } from '@match-makers/shared';
import type { Queryable } from '@/db';
import { z } from 'zod';
import { currentUserId, requireAuth } from '@/auth';
import { pool, withTransaction } from '@/db';
import { ApiError } from '@/errors';
import { asyncHandler, parse, send } from '@/http';
import { findUserById } from '@/db/users';
import { publishMessage } from '@/realtime';

export const matchesRouter = Router();

/**
 * A match row, as the app lists it.
 *
 * `MatchSummary` from `apps/mobile/src/services/matches.ts`: the **whole**
 * `User`, not the `MatchedUserSummary` of `types/api.ts`. The mock mode has
 * always sent the full partner record, and the chat and profile screens read
 * `match.user` directly, so narrowing it here would break them in a mode
 * nobody tested.
 *
 * The full record does include `email`, which is a leak in a real product --
 * see the README's "Not built yet". It is sent here for parity with mock mode.
 */
interface MatchSummary {
  id: string;
  user: User;
  createdAt: string;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  unreadCount: number;
}

const matchParamsSchema = z.object({ matchId: z.string().uuid('matchId must be a match id') });

interface MatchRow {
  match_id: string;
  other_id: string;
  created_at: Date;
  last_content: string | null;
  last_created_at: Date | null;
  unread_count: string;
}

/**
 * Every match the caller is part of, newest activity first.
 *
 * The last message and the unread count are `LATERAL` sub-selects because the
 * naive version is one query for matches, then one for the newest message in
 * each, then one for each unread count -- three round trips per conversation.
 *
 * `matches.user_a_id < user_b_id` means there is no "my side" of a match row,
 * so this checks both columns. That is the cost of making the pair unique by
 * constraint rather than by convention.
 */
matchesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);

    const { rows } = await pool.query<MatchRow>(
      `SELECT
         m.id AS match_id,
         CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END AS other_id,
         m.created_at,
         last.content    AS last_content,
         last.created_at AS last_created_at,
         COALESCE(unread.n, 0) AS unread_count
       FROM matches m
       LEFT JOIN LATERAL (
         SELECT content, created_at
           FROM messages
          WHERE match_id = m.id
          ORDER BY created_at DESC
          LIMIT 1
       ) AS last ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS n
           FROM messages
          WHERE match_id = m.id AND sender_id <> $1 AND read_at IS NULL
       ) AS unread ON true
      WHERE m.user_a_id = $1 OR m.user_b_id = $1
      ORDER BY COALESCE(last.created_at, m.created_at) DESC`,
      [viewerId]
    );

    // The partner's profile is a second read per match and is the only part not
    // joinable: a full `User` is a `User` row plus photos plus preferences, so
    // it goes back through `findUserById`.
    //
    // That returns null only if the partner was deleted, which the foreign key
    // prevents by cascading the match away first -- so in practice it cannot be
    // null here, and the cast records that rather than inventing a person.
    const summaries = await Promise.all(rows.map((row) => findUserById(row.other_id)));

    const result: MatchSummary[] = rows.map((row, i) => ({
      id: row.match_id,
      user: summaries[i] as User,
      createdAt: row.created_at.toISOString(),
      ...(row.last_content !== null ? { lastMessagePreview: row.last_content } : {}),
      ...(row.last_created_at !== null ? { lastMessageAt: row.last_created_at.toISOString() } : {}),
      unreadCount: Number(row.unread_count),
    }));

    send(res, result);
  })
);

matchesRouter.delete(
  '/:matchId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);
    const { matchId } = parse(matchParamsSchema, req.params);

    // Scoped to the caller: deleting somebody else's match is a 404, not a 403,
    // because confirming it exists is itself a leak.
    const { rowCount } = await pool.query(
      'DELETE FROM matches WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)',
      [matchId, viewerId]
    );

    if (rowCount === 0) throw ApiError.notFound('That match does not exist');

    send(res, { matchId });
  })
);

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mounted at `/messages`, not nested under `/matches`.
 *
 * `services/matches.ts` calls `/messages/${matchId}` and
 * `/messages/${matchId}/read`. Those are the paths the app was written against
 * and the ones it will use, so the API moved to them rather than the other way
 * round.
 */
export const messagesRouter = Router();

/**
 * Guard that the caller is one of the two people in the match.
 *
 * Checked against the database rather than trusting an id from the URL.
 * `MockDatabase.matchesForUser` did the same filter in memory.
 */
export async function assertParticipant(
  client: Queryable,
  matchId: string,
  userId: string
): Promise<void> {
  const { rowCount } = await client.query(
    'SELECT 1 FROM matches WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)',
    [matchId, userId]
  );
  if (rowCount === 0) {
    throw ApiError.notFound('That conversation does not exist');
  }
}

interface MessageRow {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  type: Message['type'];
  created_at: Date;
  read_at: Date | null;
}

/**
 * `MessageSummary` from `@match-makers/shared`: `{id, senderId, content, sentAt}`.
 *
 * The app adds `isMine` itself by comparing `senderId` against its own id, so
 * that is not sent.
 */
function toSummary(row: MessageRow): MessageSummary {
  return {
    id: row.id,
    senderId: row.sender_id,
    content: row.content,
    sentAt: row.created_at.toISOString(),
  };
}

messagesRouter.get(
  '/:matchId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);
    const { matchId } = parse(matchParamsSchema, req.params);

    await assertParticipant(pool, matchId, viewerId);

    const { rows } = await pool.query<MessageRow>(
      `SELECT id, match_id, sender_id, content, type, created_at, read_at
         FROM messages
        WHERE match_id = $1
        ORDER BY created_at ASC, id ASC`,
      [matchId]
    );

    // Wrapped in `{ items }` because `fetchMessages` reads `response.data.items`.
    send(res, { items: rows.map(toSummary) });
  })
);

const createMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(4000),
});

messagesRouter.post(
  '/:matchId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);
    const { matchId } = parse(matchParamsSchema, req.params);
    const body = parse(createMessageSchema, req.body);

    const created = await withTransaction(async (client) => {
      await assertParticipant(client, matchId, viewerId);

      const { rows } = await client.query<MessageRow>(
        `INSERT INTO messages (match_id, sender_id, content)
              VALUES ($1, $2, $3)
           RETURNING id, match_id, sender_id, content, type, created_at, read_at`,
        [matchId, viewerId, body.content]
      );

      const row = rows[0];
      if (!row) throw new Error('INSERT ... RETURNING produced no row');
      const summary = toSummary(row);
      await publishMessage(client, matchId, viewerId, summary.id);
      return summary;
    });

    send(res, created, 201);
  })
);

/**
 * Mark a conversation read.
 *
 * `sender_id <> $1` keeps the caller's own messages out of the update. The mock
 * did the same in `markMatchRead`, but as an O(n) scan over an array; here it is
 * a set-based update touching only the rows it means to.
 *
 * Idempotent by construction: `read_at IS NULL` means a second call matches
 * nothing.
 */
messagesRouter.post(
  '/:matchId/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);
    const { matchId } = parse(matchParamsSchema, req.params);

    const markedRead = await withTransaction(async (client) => {
      await assertParticipant(client, matchId, viewerId);

      const { rowCount } = await client.query(
        `UPDATE messages
            SET read_at = now()
          WHERE match_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
        [matchId, viewerId]
      );

      return rowCount ?? 0;
    });

    send(res, { markedRead });
  })
);
