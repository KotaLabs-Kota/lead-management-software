import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema } from 'zod';
import { validationError } from '../utils/errors';

export type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Validate and coerce a request part with a Zod schema.
 *
 * The validated value replaces `req.body` / `req.query` / `req.params`, so
 * handlers only ever see clean, typed data. All issues are returned at once
 * (422) instead of failing on the first field.
 */
export function validate<T>(schema: ZodSchema<T>, target: ValidationTarget = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || target,
        message: issue.message,
      }));
      return next(validationError('Request validation failed', details));
    }

    (req as unknown as Record<ValidationTarget, unknown>)[target] = result.data;
    next();
  };
}
