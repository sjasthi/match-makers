import type { ApiErrorCode, ApiErrorBody } from '@match-makers/shared';

/**
 * An error the client is allowed to be told about.
 *
 * Anything thrown that is *not* one of these is treated as a bug: logged with
 * its stack, answered as a bare `INTERNAL_ERROR`. That distinction is the whole
 * point -- the mobile app's HTTP branches already render `ApiErrorBody`, so the
 * only thing this server has to get right is which failures are expected.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    fieldErrors?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  toBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
    };
  }

  static unauthorized(message = 'Sign in to continue'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static notFound(message = 'Not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, 'CONFLICT', message);
  }
}

/**
 * Postgres raises a handful of error classes that are not bugs -- they are the
 * database doing exactly what the schema says. Translate the ones this schema
 * can actually raise into the vocabulary in `ApiErrorCode`, so a duplicate
 * email reads as `CONFLICT` rather than as a crash.
 *
 * The schema is written to make most of these unreachable from normal use --
 * the unique and check constraints are doing the work the mock did in code --
 * so this is the backstop, not the mechanism.
 */
const PG_STATUS: Record<string, { status: number; code: ApiErrorCode; message: string }> = {
  // unique_violation
  '23505': { status: 409, code: 'CONFLICT', message: 'That value is already taken' },
  // foreign_key_violation
  '23503': { status: 400, code: 'VALIDATION_ERROR', message: 'Referenced record does not exist' },
  // check_violation
  '23514': { status: 400, code: 'VALIDATION_ERROR', message: 'Value failed a database constraint' },
  // not_null_violation
  '23502': { status: 400, code: 'VALIDATION_ERROR', message: 'A required value was missing' },
  // invalid_text_representation -- an enum label that is not in the type
  '22P02': { status: 400, code: 'VALIDATION_ERROR', message: 'Unrecognised value' },
  // numeric_value_out_of_range
  '22003': { status: 400, code: 'VALIDATION_ERROR', message: 'Value out of range' },
};

interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const pg = error as PgError;
  if (pg && typeof pg.code === 'string') {
    const mapped = PG_STATUS[pg.code];
    if (mapped) {
      // The constraint name is the only thing that makes a 409 actionable, and
      // it is safe to expose: it is in db/schema.sql, which is public.
      const suffix = pg.constraint ? ` (${pg.constraint})` : '';
      return new ApiError(mapped.status, mapped.code, `${mapped.message}${suffix}`);
    }
  }

  return new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
}
