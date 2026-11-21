import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const windowMs = env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;

import type { Request, Response } from 'express';

function jsonHandler(code: string, message: string) {
  return (_req: Request, res: Response) => {
    res.status(429).json({ error: { code, message } });
  };
}

/** Global limiter for the whole API. */
export const apiRateLimiter = rateLimit({
  windowMs,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: jsonHandler('RATE_LIMITED', 'Too many requests, please try again later'),
});

/**
 * Stricter limiter for credential endpoints (login, refresh, password change).
 * Protects against brute-force password guessing.
 */
export const authRateLimiter = rateLimit({
  windowMs,
  limit: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: jsonHandler('RATE_LIMITED', 'Too many authentication attempts, please try again later'),
});
