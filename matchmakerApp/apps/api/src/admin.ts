import type { NextFunction, Request, Response } from 'express';
import { pool } from '@/db';
import { ApiError } from '@/errors';
import { currentUserId } from '@/auth';

/**
 * Admin authorisation.
 *
 * Reads `users.is_admin`, which only `npm run admin -- grant <email>` sets. There
 * is no HTTP route that can set it: see `scripts/admin.ts` for why a "make me an
 * admin" endpoint is the wrong shape for that.
 *
 * A database read per admin request rather than a claim in the token. An admin
 * flag baked into a JWT would keep its power until the token expired, so
 * revoking it would take an hour to take effect -- and revoking is the entire
 * point of having the command.
 */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const userId = currentUserId(req);

  const { rows } = await pool.query<{ is_admin: boolean }>(
    'SELECT is_admin FROM users WHERE id = $1',
    [userId]
  );

  const row = rows[0];

  // The account was deleted while holding a still-valid token.
  if (!row) {
    next(ApiError.notFound('Account no longer exists'));
    return;
  }

  if (!row.is_admin) {
    // 403, not 404. The caller has proved who they are, so pretending the
    // endpoint does not exist would be a lie -- and it would make debugging a
    // permission problem harder, which is the opposite of what a 403 is for.
    next(new ApiError(403, 'FORBIDDEN', 'This action is restricted to administrators'));
    return;
  }

  next();
}

/** Whether an account has admin, for conditional UI. Never throws. */
export async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;

  const { rows } = await pool.query<{ is_admin: boolean }>(
    'SELECT is_admin FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.is_admin ?? false;
}
