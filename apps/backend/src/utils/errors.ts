/**
 * Application errors.
 *
 * Every expected failure is an AppError with a machine readable `code` and an
 * HTTP status. The error middleware turns these into the standard JSON body:
 *   { "error": { "code": "...", "message": "...", "details": ... } }
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_LEAD'
  | 'DUPLICATE_DEVICE'
  | 'DEVICE_REVOKED'
  | 'ACCOUNT_DISABLED'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const validationError = (message: string, details?: unknown) =>
  new AppError(422, 'VALIDATION_ERROR', message, details);

export const unauthorized = (message = 'Authentication required', code: ErrorCode = 'UNAUTHORIZED') =>
  new AppError(401, code, message);

export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} not found`);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);
