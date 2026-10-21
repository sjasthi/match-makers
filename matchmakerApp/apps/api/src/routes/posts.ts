import { Router } from 'express';
import { postTagListSchema } from '@match-makers/shared';
import type {
  PhotoFeedPage,
  PostReactionAction,
  PostReactionRequest,
  PostVariant,
  TasteSummary,
} from '@match-makers/shared';
import { z } from 'zod';
import { requireAdmin } from '@/admin';
import { applyReactionToAffinity } from '@/affinity';
import { currentUserId, optionalAuth, requireAuth } from '@/auth';
import { pool, withTransaction, type Queryable } from '@/db';
import { toPost, type PostRow } from '@/db/rows';
import { ApiError } from '@/errors';
import { asyncHandler, parse, send } from '@/http';

export const postsRouter = Router();

/**
 * A rendition the client sent.
 *
 * The ladder is built on the device, by the resampler in
 * `services/imageImport.ts`, because that is where the pixels are: the client
 * has the original and the server does not. The API stores what it is given.
 */
const postIdSchema = z.object({ postId: z.string().uuid('postId must be a post id') });

const variantSchema = z.object({
  width: z.number().int().positive(),
  uri: z.string().min(1),
});

/**
 * Loads the rendition ladder for a set of posts.
 *
 * One query for the whole page rather than one per post, because the feed
 * shows ten photos at a time and ten round trips to assemble one screen is
 * exactly the kind of thing that feels like a slow app.
 */
export async function loadVariants(postIds: string[]): Promise<Map<string, PostVariant[]>> {
  const byPost = new Map<string, PostVariant[]>();
  if (postIds.length === 0) return byPost;

  const { rows } = await pool.query<{ post_id: string; width: number; uri: string }>(
    `SELECT post_id, width, uri
       FROM post_images
      WHERE post_id = ANY($1::uuid[])
      ORDER BY post_id, width DESC`,
    [postIds]
  );

  for (const row of rows) {
    const list = byPost.get(row.post_id) ?? [];
    list.push({ width: row.width, uri: row.uri });
    byPost.set(row.post_id, list);
  }
  return byPost;
}

const SELECT_POSTS = `
  SELECT id, image_uri, thumb_uri, width, height, tags, created_at
    FROM posts
`;

/**
 * The photo feed.
 *
 * Every post is returned, answered or not, rather than only the unanswered
 * ones -- that is what makes undo possible, because a photo you can change your
 * mind about has to still be on screen to change your mind about. `total` is
 * the size of the whole library so the screen can tell "every photo answered"
 * apart from "nobody has imported any photos", which look identical from the
 * posts array alone and have opposite fixes.
 *
 * `reactions` is this caller's own answer per post id, as a map, so a grid can
 * render which way each tile was answered without N+1 lookups. A missing key
 * means unanswered, which is why it is a map and not a count.
 *
 * Auth is optional here and nowhere else: the library is public, only the
 * reactions are not. An anonymous caller gets the posts and empty maps.
 */
postsRouter.get(
  '/feed',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewerId = req.userId;

    const [posts, reactions, summary] = await Promise.all([
      pool.query<PostRow>(`${SELECT_POSTS} ORDER BY created_at DESC, id DESC`),
      viewerId
        ? pool.query<{ post_id: string; action: PostReactionAction }>(
            'SELECT post_id, action FROM post_reactions WHERE user_id = $1',
            [viewerId]
          )
        : Promise.resolve({ rows: [] as Array<{ post_id: string; action: PostReactionAction }> }),
      viewerId
        ? loadTasteSummary(pool, viewerId)
        : Promise.resolve({ likes: 0, dislikes: 0, tags: [], closest: [] }),
    ]);

    const variants = await loadVariants(posts.rows.map((row) => row.id));

    const page: PhotoFeedPage = {
      posts: posts.rows.map((row) => toPost(row, variants.get(row.id) ?? [])),
      reactions: Object.fromEntries(reactions.rows.map((r) => [r.post_id, r.action])),
      total: posts.rows.length,
      summary,
    };

    send(res, page);
  })
);

/**
 * React to a post.
 *
 * This is the clearest case for having moved off the JSON blob. The mock's
 * `recordPostReaction` loaded the whole reaction list, searched it for an entry
 * with the same `(userId, postId)`, and rewrote the entire database to replace
 * one row. Here it is one statement: `UNIQUE (user_id, post_id)` names the row
 * to replace, and Postgres does the replacing.
 *
 * A dislike after a like therefore reads as dislike and never as both, which is
 * the rule `PostReaction` documents.
 */
postsRouter.post(
  '/reactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);
    const body = parse(postReactionRequestSchema, req.body);

    const reaction = await withTransaction(async (client) => {
      const exists = await client.query<{ tags: string[] }>(
        'SELECT tags FROM posts WHERE id = $1',
        [body.postId]
      );
      if (exists.rowCount === 0) throw ApiError.notFound('That photo is no longer in the library');
      const tags = exists.rows[0]?.tags ?? [];

      // What the caller previously answered, so a like turned into a dislike
      // moves the tag vector in both directions rather than only one.
      const previous = await client.query<{ action: 'like' | 'dislike' }>(
        'SELECT action FROM post_reactions WHERE user_id = $1 AND post_id = $2',
        [viewerId, body.postId]
      );
      const oldAction = previous.rows[0]?.action;

      const { rows } = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO post_reactions (user_id, post_id, action)
              VALUES ($1, $2, $3)
         ON CONFLICT (user_id, post_id)
         DO UPDATE SET action = EXCLUDED.action, created_at = now()
         RETURNING id, created_at`,
        [viewerId, body.postId, body.action]
      );

      /*
       * Fold the change into the tag-weight vector.
       *
       * A flip (like -> dislike) is two moves: take the old one back, apply the
       * new one. Without this, changing your mind about a photo would leave the
       * vector counting both opinions at once.
       */
      if (oldAction && oldAction !== body.action) {
        await applyReactionToAffinity(client, viewerId, tags, oldAction, { undo: true });
      }
      await applyReactionToAffinity(client, viewerId, tags, body.action);

      const row = rows[0];
      return {
        id: row?.id ?? '',
        userId: viewerId,
        postId: body.postId,
        action: body.action,
        createdAt: (row?.created_at ?? new Date(0)).toISOString(),
      };
    });

    send(res, reaction, 201);
  })
);

/**
 * Take a reaction back.
 *
 * A delete rather than a "neutral" row: `removePostReaction` in the mock deleted
 * too, and an unanswered photo has to stay distinguishable from one answered
 * with neither like nor dislike for the "N of M answered" count to mean
 * anything.
 *
 * Returns `{ removed }` because `undoPostReaction` reads that, and it is a real
 * answer rather than a 200 either way: deleting a reaction that was not there
 * reports `false`, so a double-tap undo is idempotent from the caller's side.
 */
postsRouter.delete(
  '/reactions/:postId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);
    const { postId } = parse(postIdSchema, req.params);

    const result = await withTransaction(async (client) => {
      // The reaction being taken back, and the tags it was voting for, so the
      // tag vector can move with it. Deleting without this would leave the
      // vector claiming an opinion the reactions table no longer supports.
      const existing = await client.query<{ action: 'like' | 'dislike'; tags: string[] }>(
        `SELECT r.action, p.tags
           FROM post_reactions r
           JOIN posts p ON p.id = r.post_id
          WHERE r.user_id = $1 AND r.post_id = $2`,
        [viewerId, postId]
      );
      const row = existing.rows[0];

      const deleted = await client.query(
        'DELETE FROM post_reactions WHERE user_id = $1 AND post_id = $2',
        [viewerId, postId]
      );

      if (row && (deleted.rowCount ?? 0) > 0) {
        await applyReactionToAffinity(client, viewerId, row.tags, row.action, { undo: true });
      }

      return (deleted.rowCount ?? 0) > 0;
    });

    send(res, { removed: result });
  })
);

/**
 * The taste summary on its own.
 *
 * Separate from `/posts/feed` because `fetchTasteSummary` is called after every
 * reaction settles: reloading the whole feed to redraw one line would reorder
 * the posts under the person who is looking at them.
 */
postsRouter.get(
  '/taste',
  requireAuth,
  asyncHandler(async (req, res) => {
    send(res, { summary: await loadTasteSummary(pool, currentUserId(req)) });
  })
);

/**
 * The library size.
 *
 * `fetchPostCount` asks for `{ total }` with `pageSize: 1`, so that it can tell
 * "nobody has imported any photos" apart from "every photo is answered". The
 * two look identical from the posts array alone and have opposite fixes.
 *
 * `pageSize` is accepted and ignored rather than honoured: a count is a count,
 * and implementing paging here would mean this route and `/feed` disagree about
 * what a page is.
 *
 * Declared before `/:postId` so it is not swallowed by that route.
 */
postsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM posts'
    );
    send(res, { total: Number(rows[0]?.total ?? 0) });
  })
);

/**
 * One post, with its rendition ladder.
 *
 * Declared last, because `/:postId` would otherwise swallow `/feed`, `/taste`
 * and the rest.
 */
postsRouter.get(
  '/:postId',
  asyncHandler(async (req, res) => {
    const { postId } = parse(postIdSchema, req.params);
    const { rows } = await pool.query<PostRow>(`${SELECT_POSTS} WHERE id = $1`, [postId]);
    const row = rows[0];
    if (!row) throw ApiError.notFound('That photo is no longer in the library');

    const variants = await loadVariants([postId]);
    send(res, toPost(row, variants.get(postId) ?? []));
  })
);

/**
 * The body of a tag edit.
 *
 * `postTagListSchema` folds and de-duplicates the same way the editor does, so
 * an edit that arrives with `Dogs` twice stores one `dog`.
 */
const updateTagsSchema = z.object({
  tags: postTagListSchema('A photo needs at least one tag to be matched on'),
});

/**
 * Change a photo's tags.
 *
 * This is what the tag editor in the admin library calls, and it is the reason
 * the edit used to vanish: the client merged the new tags into the copy of the
 * photo it already had and sent **nothing**. There was no route to send it to,
 * so the screen showed the new tags and the database kept the old ones.
 *
 * Retagging a photo also changes what it says about everybody who liked it, so
 * their tag vectors are moved with it. A photo's tags are the unit the vector
 * counts, and leaving the old ones behind would mean somebody still "leans
 * towards" a tag they have never reacted to.
 */
postsRouter.patch(
  '/:postId',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { postId } = parse(postIdSchema, req.params);
    const body = parse(updateTagsSchema, req.body);

    const updated = await withTransaction(async (client) => {
      const existing = await client.query<{ tags: string[] }>(
        'SELECT tags FROM posts WHERE id = $1',
        [postId]
      );
      const before = existing.rows[0]?.tags ?? [];
      if (existing.rowCount === 0) {
        throw ApiError.notFound('That photo is no longer in the library');
      }

      await client.query('UPDATE posts SET tags = $2 WHERE id = $1', [postId, body.tags]);

      // Move everybody who answered this photo onto the new tags.
      if (before.join('\u0000') !== body.tags.join('\u0000')) {
        const reactors = await client.query<{ user_id: string; action: 'like' | 'dislike' }>(
          'SELECT user_id, action FROM post_reactions WHERE post_id = $1',
          [postId]
        );

        for (const reactor of reactors.rows) {
          await applyReactionToAffinity(client, reactor.user_id, before, reactor.action, {
            undo: true,
          });
          await applyReactionToAffinity(client, reactor.user_id, body.tags, reactor.action);
        }
      }

      const { rows: post } = await client.query<PostRow>(`${SELECT_POSTS} WHERE id = $1`, [postId]);
      const row = post[0];
      if (!row) throw ApiError.notFound('That photo is no longer in the library');

      const variants = await loadVariants([postId]);
      return toPost(row, variants.get(postId) ?? []);
    });

    send(res, updated);
  })
);

const importPostsSchema = z.array(
  z.object({
    imageUri: z.string().min(1, 'The image is missing'),
    thumbUri: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    tags: z.array(z.string().min(1)).min(1).max(8),
    /** The renditions below the largest one. */
    variants: z.array(variantSchema).max(8).optional(),
  })
);

/**
 * Import into the library.
 *
 * Admin-only, via `requireAdmin` reading `users.is_admin`, which only
 * `npm run admin -- grant <email>` can set. This is what the app's
 * "Admin: photo library" importer calls, so it is the route that gets content
 * into the feed, and it is deliberately unavailable to ordinary accounts.
 */
postsRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    // `parse` rather than `.parse` directly, so a bad body comes back as a 400
    // with `fieldErrors` instead of a `ZodError` reaching the error handler as
    // an unknown bug and being reported as a 500. The import screen's rows then
    // light up per field rather than showing a generic failure.
    const drafts = parse(importPostsSchema, req.body);

    const imported = await withTransaction(async (client) => {
      const ids: string[] = [];

      for (const draft of drafts) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO posts (image_uri, thumb_uri, width, height, tags)
                VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
          [
            draft.imageUri,
            draft.thumbUri ?? null,
            draft.width ?? null,
            draft.height ?? null,
            draft.tags,
          ]
        );

        const id = rows[0]?.id;
        if (!id) continue;
        ids.push(id);

        // The ladder, widest first. A duplicate width is replaced rather than
        // rejected: re-importing the same photo should not fail on a conflict.
        for (const variant of draft.variants ?? []) {
          await client.query(
            `INSERT INTO post_images (post_id, width, uri) VALUES ($1, $2, $3)
             ON CONFLICT (post_id, width) DO UPDATE SET uri = EXCLUDED.uri`,
            [id, variant.width, variant.uri]
          );
        }
      }

      return ids;
    });

    send(res, { imported: imported.length, ids: imported }, 201);
  })
);

/**
 * Delete a post, and its reactions with it.
 *
 * The mock did this by hand in `deletePost` -- fetch the reactions, filter, put
 * both back. `ON DELETE CASCADE` on `post_reactions.post_id` means the database
 * does it, and means it cannot be forgotten: there is no code path that deletes
 * a post without deleting its reactions.
 *
 * This route previously had **no authentication at all** -- no `requireAuth`,
 * let alone an admin check -- so any anonymous request that knew the URL could
 * delete a photo and cascade away its reactions. It was the one route here
 * reachable by anyone, and nothing caught it: every test exercised the paths the
 * app happened to call, and the app never called this one.
 */
postsRouter.delete(
  '/:postId',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { postId } = parse(postIdSchema, req.params);

    const { rowCount } = await pool.query('DELETE FROM posts WHERE id = $1', [postId]);

    // Reported rather than always answering 200, so a double-tap is
    // distinguishable from a real delete, the way `DELETE
    // /posts/reactions/:postId` already does it.
    send(res, { postId, deleted: (rowCount ?? 0) > 0 });
  })
);

/**
 * The reaction *request*: `{ postId, action }`.
 *
 * NOT `postReactionSchema` from `@match-makers/shared`, which validates the
 * whole stored record -- `id`, `userId`, `action`, `createdAt`. That is the
 * `PostReaction` row, not a request: the caller does not choose their own user
 * id and the server assigns the id and the timestamp.
 *
 * `PostReactionRequest` in `types/api.ts` already documents the correct shape as
 * `{ postId, action }`, so this is a transcription of that type rather than a
 * second opinion about it. Same mismatch as `profilePhotoSchema` in
 * `routes/profile.ts`, and the same decision not to fix `@match-makers/shared` in
 * a change that is meant to be about the database.
 */
const postReactionRequestSchema = z.object({
  postId: z.string().uuid('postId must be a post id'),
  action: z.enum(['like', 'dislike']),
}) satisfies z.ZodType<PostReactionRequest>;

/**
 * The caller's taste summary.
 *
 * Tag scores are computed with a `GIN` index on `posts.tags` doing the work:
 * unnesting the caller's liked tags, joining to the posts carrying them, and
 * averaging per tag. `PHOTOS_FOR_FULL_TASTE` in `utils/taste.ts` caps how many
 * likes count towards full confidence -- not reimplemented here, so this is the
 * uncapped number and will not match the client's exactly until the scoring
 * moves server-side. Flagged in the README.
 *
 * `closest` is left empty: populating it needs `scoreCompatibility`, which is
 * still client-side.
 */
async function loadTasteSummary(client: Queryable, viewerId: string): Promise<TasteSummary> {
  const totals = await client.query<{ action: PostReactionAction; n: string }>(
    `SELECT action, count(*) AS n
       FROM post_reactions
      WHERE user_id = $1
      GROUP BY action`,
    [viewerId]
  );

  const byAction = new Map(totals.rows.map((row) => [row.action, Number(row.n)]));

  const tags = await client.query<{
    tag: string;
    likes: string;
    dislikes: string;
    score: string;
  }>(
    `SELECT tag,
            count(*) FILTER (WHERE reaction.action = 'like')    AS likes,
            count(*) FILTER (WHERE reaction.action = 'dislike') AS dislikes,
            (count(*) FILTER (WHERE reaction.action = 'like')
             - count(*) FILTER (WHERE reaction.action = 'dislike'))::float8 / count(*) AS score
       FROM post_reactions reaction
       JOIN posts post ON post.id = reaction.post_id
       CROSS JOIN LATERAL unnest(post.tags) AS tag
      WHERE reaction.user_id = $1
      GROUP BY tag
      ORDER BY abs(
        (count(*) FILTER (WHERE reaction.action = 'like')
         - count(*) FILTER (WHERE reaction.action = 'dislike'))::float8 / count(*)
      ) DESC
      LIMIT 12`,
    [viewerId]
  );

  return {
    likes: byAction.get('like') ?? 0,
    dislikes: byAction.get('dislike') ?? 0,
    tags: tags.rows.map((row) => ({
      tag: row.tag,
      score: Number(row.score),
      likes: Number(row.likes),
      dislikes: Number(row.dislikes),
    })),
    closest: [],
  };
}
