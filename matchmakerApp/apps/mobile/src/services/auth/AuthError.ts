import type { ApiErrorCode } from '@match-makers/shared';

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

/** Normalised error thrown by every adapter, so UI code has one shape to handle. */
export class AuthError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    options: { code?: ApiErrorCode; status?: number; fieldErrors?: Record<string, string> } = {}
  ) {
    super(message);
    this.name = 'AuthError';
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.status = options.status;
    this.fieldErrors = options.fieldErrors;
  }

  static fromStatus(status: number, message: string, fieldErrors?: Record<string, string>) {
    return new AuthError(message, {
      code: STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR',
      status,
      fieldErrors,
    });
  }

  static unknown(reason: unknown): AuthError {
    if (reason instanceof AuthError) return reason;
    if (reason instanceof Error) return new AuthError(reason.message);
    return new AuthError('Something went wrong. Please try again.');
  }
}
