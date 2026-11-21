import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '../types/domain';
import { unauthorized } from './errors';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  role: UserRole;
  tokenType: 'access';
}

const BASE_OPTIONS: SignOptions = {
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  algorithm: 'HS256',
};

export function signAccessToken(user: { id: string; role: UserRole }): {
  token: string;
  expiresInSeconds: number;
} {
  const expiresInSeconds = env.JWT_ACCESS_TTL_MINUTES * 60;
  const token = jwt.sign(
    { role: user.role, tokenType: 'access' },
    env.JWT_ACCESS_SECRET,
    { ...BASE_OPTIONS, subject: user.id, expiresIn: expiresInSeconds },
  );
  return { token, expiresInSeconds };
}

/**
 * Verify an access token. Throws AppError(401) with a specific code so the
 * frontend can distinguish "session expired" (refresh it) from "invalid token".
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });

    if (typeof decoded === 'string' || !decoded.sub || decoded.tokenType !== 'access') {
      throw unauthorized('Invalid access token', 'INVALID_TOKEN');
    }

    return decoded as AccessTokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw unauthorized('Invalid access token', 'INVALID_TOKEN');
    }
    throw error;
  }
}
