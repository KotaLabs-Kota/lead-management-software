import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { authRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
} from './auth.schemas';
import { changePassword, login, logout, me, refresh } from './auth.service';

export const authRouter = Router();

/** POST /api/auth/login — exchange email + password for an access token and a refresh token. */
authRouter.post('/login', authRateLimiter, validate(loginSchema), asyncHandler(login));

/** POST /api/auth/refresh — rotate the refresh token and issue a new access token. */
authRouter.post('/refresh', authRateLimiter, validate(refreshSchema), asyncHandler(refresh));

/** POST /api/auth/logout — revoke the presented refresh token. */
authRouter.post('/logout', validate(refreshSchema), asyncHandler(logout));

/** GET /api/auth/me — current user profile. */
authRouter.get('/me', authenticate, asyncHandler(me));

/** POST /api/auth/change-password — change own password (revokes all refresh tokens). */
authRouter.post(
  '/change-password',
  authenticate,
  authRateLimiter,
  validate(changePasswordSchema),
  asyncHandler(changePassword),
);
