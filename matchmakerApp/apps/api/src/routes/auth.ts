import { Router } from 'express';
import type { AuthResult, User } from '@match-makers/shared';
import type { Queryable } from '@/db';
import { z } from 'zod';
import {
  buildTokens,
  currentUserId,
  hashRefreshToken,
  issueRefreshToken,
  requireAuth,
} from '@/auth';
import { pool, withTransaction } from '@/db';
import { isProduction } from '@/env';
import { findCredentialsByEmail, findUserByEmail, getUserById } from '@/db/users';
import { ApiError } from '@/errors';
import { asyncHandler, parse, send } from '@/http';
import { hashPassword, verifyPassword } from '@/password';

export const authRouter = Router();

/**
 * What register and login send.
 *
 * `RegisterData` from `@match-makers/shared`, not `registerSchema`.
 *
 * `registerSchema` also requires `confirmPassword` -- it was written for a form
 * that shows two password boxes. The app sends `RegisterData`, so validating
 * against `registerSchema` rejected every real registration with a
 * "confirmPassword required" the client has no field to fix.
 *
 * Re-confirming a password only catches a typo, and the API has no form to
 * render that message next to. That check belongs in the UI.
 */
const registerBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  name: z.string().min(1, 'Name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'non_binary', 'prefer_not_to_say']),
});

const loginBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * A real scrypt hash of a value nobody can supply, so the unknown-account path
 * costs the same as the known-account one. Without this, "no such email"
 * answers measurably faster than "wrong password" and the endpoint becomes an
 * oracle for which addresses have accounts.
 *
 * Not a hash of a guessable password, because that would verify against it.
 */
const DUMMY_HASH = `scrypt$16384$8$1$${'0'.repeat(32)}${'0'.repeat(128)}`;

/**
 * Insert a refresh token and return the `AuthResult` the app expects.
 *
 * The shared `AuthResult` is satisfiable now that refresh tokens exist, so this
 * returns the real type rather than the stand-in that was here before.
 */
async function issueAuthResult(client: Queryable, user: User): Promise<AuthResult> {
  const refresh = issueRefreshToken();

  await client.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, refresh.hash, refresh.expiresAt]
  );

  return {
    user,
    tokens: buildTokens(user.id, refresh.token),
    sessionId: user.id,
  };
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = parse(registerBodySchema, req.body);

    const existing = await findUserByEmail(body.email);
    if (existing) {
      throw ApiError.conflict('An account with that email already exists');
    }

    const passwordHash = await hashPassword(body.password);

    const userId = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, name, date_of_birth, gender)
         VALUES (lower(btrim($1)), $2, $3, $4, $5)
         RETURNING id`,
        [body.email, passwordHash, body.name, body.dateOfBirth, body.gender]
      );

      const created = rows[0];
      if (!created) throw new Error('INSERT ... RETURNING id produced no row');

      await client.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [created.id]);

      return created.id;
    });

    // Read *after* the transaction commits. `getUserById` goes through the pool,
    // which hands out a different connection than the one holding the open
    // transaction, and an uncommitted insert is invisible to every other
    // connection by design.
    const user = await getUserById(userId);

    send(res, await issueAuthResult(pool, user), 201);
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parse(loginBodySchema, req.body);

    const credentials = await findCredentialsByEmail(body.email);

    const ok = await verifyPassword(body.password, credentials?.passwordHash ?? DUMMY_HASH);
    if (!credentials || !ok) {
      throw ApiError.unauthorized('Email or password is incorrect');
    }

    const user = await getUserById(credentials.id);
    send(res, await issueAuthResult(pool, user));
  })
);

const refreshBodySchema = z.object({ refreshToken: z.string().min(1, 'refreshToken is required') });

/**
 * Exchange a refresh token for a new pair.
 *
 * `JWTAuthAdapter.refresh()` posts the stored token here from the API client's
 * 401 interceptor, so without this route every session died after an hour.
 *
 * Rotation: the presented token is revoked and a new one issued. If a revoked
 * token is presented again, that is either a replay or a stolen copy of the
 * database, and the honest response is to revoke the whole family rather than
 * quietly mint a third token -- so every live token for that user is killed.
 */
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = parse(refreshBodySchema, req.body);
    const presented = hashRefreshToken(body.refreshToken);

    const result = await withTransaction(async (client) => {
      const found = await client.query<{
        user_id: string;
        revoked_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT user_id, revoked_at, expires_at
           FROM refresh_tokens
          WHERE token_hash = $1
          FOR UPDATE`,
        [presented]
      );

      const row = found.rows[0];
      if (!row) throw ApiError.unauthorized('Refresh token is not recognised');
      if (row.revoked_at !== null) {
        // Replay of a token already spent. Treat the account as compromised.
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [row.user_id]
        );
        throw ApiError.unauthorized('Refresh token has already been used. Please sign in again.');
      }
      if (row.expires_at.getTime() <= Date.now()) {
        throw ApiError.unauthorized('Session has expired. Please sign in again.');
      }

      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
        presented,
      ]);

      const replacement = issueRefreshToken();
      await client.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [row.user_id, replacement.hash, replacement.expiresAt]
      );

      return buildTokens(row.user_id, replacement.token);
    });

    send(res, { tokens: result });
  })
);

/**
 * Logout.
 *
 * Revokes the presented refresh token. The access token is left alone -- it is
 * stateless and expires within the hour -- which is the documented cost of the
 * two-tier scheme, and the reason the access TTL is short.
 *
 * Requires auth only so an unauthenticated caller gets a 401 rather than a
 * misleading 200; a missing token is treated as "already logged out".
 */
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;

    if (typeof token === 'string' && token.length > 0) {
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [hashRefreshToken(token), currentUserId(req)]
      );
    } else {
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [currentUserId(req)]
      );
    }

    send(res, { ok: true });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    send(res, await getUserById(currentUserId(req)));
  })
);

/**
 * Test cleanup. Deletes a user and everything cascading from them.
 *
 * Exists only so `apiConnection.test.ts` can tidy up after itself against a
 * database that may hold real data. It is refused outright when
 * `NODE_ENV=production`, and it is not an admin API -- there is no role system,
 * so anyone who can reach it in development can delete any account. That is
 * acceptable for a local demo and is why it refuses to run in production.
 */
authRouter.delete(
  '/dev/users/:userId',
  asyncHandler(async (req, res) => {
    if (isProduction) {
      throw new ApiError(404, 'NOT_FOUND', 'No such endpoint');
    }

    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.params);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    send(res, { userId, deleted: true });
  })
);
