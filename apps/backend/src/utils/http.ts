import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not forward rejected promises to the error middleware, so
 * every async route handler is wrapped with this helper.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function buildPageMeta(page: number, pageSize: number, total: number): PageMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: page === 0 ? 0 : Math.ceil(total / pageSize),
  };
}
