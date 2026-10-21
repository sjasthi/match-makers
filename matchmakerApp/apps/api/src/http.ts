import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type ZodType, type ZodTypeDef } from 'zod';
import type { ApiEnvelope } from '@match-makers/shared';
import { ApiError } from '@/errors';

/**
 * Wraps a handler so a rejected promise reaches the error middleware.
 *
 * Express 4 does not do this on its own -- an async handler that throws leaves
 * the request hanging until it times out. Express 5 does, and this is the one
 * line that would be deleted if/when this moves to 5.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * The success shape, from `apps/shared/src/types/api.ts`.
 *
 * The mobile app's `JWTAuthAdapter` already unwraps `{ data }`, so this is the
 * contract it was written against and not a new one.
 */
export function send<T>(res: Response, data: T, status = 200): void {
  const body: ApiEnvelope<T> = { data };
  res.status(status).json(body);
}

/**
 * Validate and narrow a request part with a schema from `@match-makers/shared`.
 *
 * Those schemas are the app's own -- `passwordSchema`, `profileSetupSchema`,
 * `postReactionSchema` -- so the rules that decide what may be stored are
 * written once. This is the boundary where they start being enforced.
 *
 * Failures come back as `fieldErrors` keyed by field name, which is the shape
 * `ApiErrorBody` documents and what the existing forms render.
 */
export function parse<T extends ZodType<unknown, ZodTypeDef, unknown>>(
  schema: T,
  value: unknown
): ReturnType<T['parse']> {
  const result = schema.safeParse(value);

  if (result.success) return result.data as ReturnType<T['parse']>;

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    // Path as a dotted string, so a nested error reads `preferences.ageRange.min`
    // rather than only the top-level `preferences`.
    const field = issue.path.join('.') || '_';
    // First issue wins, because a form shows one message per field and the
    // shortest path is the most specific one.
    fieldErrors[field] ??= issue.message;
  }

  throw new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields', fieldErrors);
}
