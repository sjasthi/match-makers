import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthTokens } from '@match-makers/shared';
import { env } from '@/env';
import { ApiError } from '@/errors';

/**
 * Tokens.
 *
 * Two kinds, deliberately different in shape because they solve different
 * problems:
 *
 * - **Access tokens** are signed and stateless: the user id is in the payload
 *   and the signature proves this server issued it. Verification is one HMAC and
 *   needs no lookup. They expire in an hour and cannot be withdrawn early.
 * - **Refresh tokens** are opaque random strings, stored hashed. They cannot be
 *   verified without a database hit, which is the trade that buys real logout:
 *   revoking one is a write.
 *
 * `fp_reviews.md` wants Redis to hold sessions. This uses a Postgres table
 * instead, which is the same shape Redis would be given (a key per token with a
 * TTL) and costs one query on refresh rather than one on every request.
 */

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_DAYS = 30;

interface AccessTokenPayload {
  /** User id. */
  sub: string;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

function sign(data: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(data).digest('base64url');
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function issueAccessToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayload = {
    sub: userId,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Verify an access token, or return null.
 *
 * The signature is compared with `timingSafeEqual` rather than `===` so response
 * time does not leak how many leading characters were correct.
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let payload: AccessTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AccessTokenPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp * 1000 <= Date.now()) return null;

  return payload;
}

/**
 * A fresh refresh token, plus the hash to persist for it.
 *
 * 32 bytes of CSPRNG hex: 256 bits of entropy, so there is nothing to guess.
 * That is why this is hashed with plain SHA-256 while passwords use scrypt --
 * scrypt exists to make *low* entropy guessing expensive, and paying that cost
 * on every refresh would only slow the request down. It is still hashed, so a
 * database dump does not hand out working sessions.
 */
export function issueRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    hash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Both tokens, as `AuthTokens` from `@match-makers/shared`.
 *
 * This satisfies the shared type at last. It could not while there were no
 * refresh tokens, and the API returned its own token shape instead of claiming
 * one it could not fill in.
 */
export function buildTokens(userId: string, refreshToken: string): AuthTokens {
  return {
    accessToken: issueAccessToken(userId),
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present when `requireAuth` has run. */
      userId?: string;
    }
  }
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

/** Reject the request unless it carries a valid access token. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearer(req);
  if (!token) {
    next(ApiError.unauthorized('Missing bearer token'));
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    next(ApiError.unauthorized('Token is invalid or has expired'));
    return;
  }

  req.userId = payload.sub;
  next();
}

/**
 * Attach the user id when a token is present, but do not require it.
 *
 * The photo feed reads the caller's own reactions to render which way each tile
 * was answered, but the library itself is public -- `PhotoFeedPage` returns
 * every post, answered or not, which is what makes undo possible. So an
 * anonymous caller gets the posts and empty maps, not a 401.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearer(req);
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) req.userId = payload.sub;
  }
  next();
}

/** The authenticated user id, for use inside a `requireAuth` route. */
export function currentUserId(req: Request): string {
  if (!req.userId) throw ApiError.unauthorized();
  return req.userId;
}
