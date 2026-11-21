import type { ErrorRequestHandler, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { AppError } from '../utils/errors';

interface PostgresError {
  code?: string;
  constraint?: string;
  detail?: string;
}

/**
 * Central error handler. Every response uses the same shape:
 *   { "error": { "code": "...", "message": "...", "details": ... } }
 *
 * PostgreSQL constraint violations are translated into API errors so raw
 * database messages never leak to clients.
 */
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next,
): void => {
  const requestId = req.requestId;

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, requestId }, 'Application error');
    } else {
      logger.info({ code: error.code, status: error.statusCode, requestId }, error.message);
    }
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  // PostgreSQL error codes
  const pgError = error as PostgresError | null;
  if (pgError && typeof pgError.code === 'string') {
    if (pgError.code === '23505') {
      // unique_violation
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'A record with the same unique value already exists',
          details: { constraint: pgError.constraint ?? null },
        },
      });
      return;
    }
    if (pgError.code === '23503') {
      // foreign_key_violation
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'The referenced record does not exist or cannot be removed',
          details: { constraint: pgError.constraint ?? null },
        },
      });
      return;
    }
    if (pgError.code === '23514') {
      // check_violation
      res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A value does not satisfy a database constraint',
          details: { constraint: pgError.constraint ?? null },
        },
      });
      return;
    }
  }

  // Body parser errors (invalid JSON, payload too large)
  const bodyError = error as { type?: string; status?: number } | null;
  if (bodyError?.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
    return;
  }
  if (bodyError?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON' },
    });
    return;
  }

  logger.error({ err: error, requestId }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
};

/** 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
}
