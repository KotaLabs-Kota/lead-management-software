import type { NextFunction, Request, Response } from 'express';
import { enforceOwnerAccountBlock } from '../modules/owner/owner-control';
import { maybeOne } from '../db/pool';
import type { UserRole } from '../types/domain';
import { forbidden, unauthorized } from '../utils/errors';
import { matchesPasswordVersion, verifyAccessToken } from '../utils/jwt';

export interface AuthContext {
  userId: string;
  role: UserRole;
  email: string;
  name: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'ACTIVE' | 'DISABLED';
  password_hash: string;
}

/**
 * Authenticate a web request using the JWT access token in the
 * `Authorization: Bearer <token>` header.
 *
 * The user row is re-read on every request so that disabling an account takes
 * effect immediately — a valid token alone is not enough.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      throw unauthorized('Missing Authorization header');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) throw unauthorized('Missing access token');

    const payload = verifyAccessToken(token);

    const user = await maybeOne<UserRow>(
      `SELECT id, email, name, role, status, password_hash FROM users WHERE id = $1`,
      [payload.sub],
    );

    if (!user) throw unauthorized('User no longer exists', 'INVALID_TOKEN');
    if (user.status !== 'ACTIVE') {
      throw unauthorized('This account has been disabled', 'ACCOUNT_DISABLED');
    }

    if (!matchesPasswordVersion(payload.passwordVersion, user.password_hash)) {
      throw unauthorized('Session expired. Please sign in again.', 'INVALID_TOKEN');
    }

    await enforceOwnerAccountBlock(user.id);
    req.auth = { userId: user.id, role: user.role, email: user.email, name: user.name };
    next();
  } catch (error) {
    next(error);
  }
}

/** Restrict a route to one or more roles. Must run after `authenticate`. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

/** Convenience guard for admin-only routes. */
export const requireAdmin = requireRole('ADMIN');
