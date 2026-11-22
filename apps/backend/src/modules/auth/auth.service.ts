import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { maybeOne, one, withTransaction } from '../../db/pool';
import { logger } from '../../lib/logger';
import type { UserRole, UserStatus } from '../../types/domain';
import { invalidCredentials, unauthorized } from '../../utils/errors';
import { signAccessToken } from '../../utils/jwt';
import { hashPassword, verifyPassword } from '../../utils/password';
import { generateOpaqueToken, REFRESH_TOKEN_PREFIX, sha256 } from '../../utils/tokens';
import type { ChangePasswordInput, LoginInput, RefreshInput } from './auth.schemas';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  last_login_at: Date | null;
}

const USER_COLUMNS = 'id, email, password_hash, name, role, status, last_login_at';

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lastLoginAt: user.last_login_at,
  };
}

async function issueSession(user: UserRow) {
  const { token: accessToken, expiresInSeconds } = signAccessToken(user);
  const refreshToken = generateOpaqueToken(REFRESH_TOKEN_PREFIX);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await one(
    `INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [user.id, sha256(refreshToken), expiresAt],
  );

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: expiresInSeconds,
    user: publicUser(user),
  };
}

/** POST /api/auth/login */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginInput;

  const user = await maybeOne<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
    [email],
  );

  // Same error for "no such user" and "wrong password" so we do not reveal
  // which email addresses exist.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw invalidCredentials();
  }
  if (user.status !== 'ACTIVE') {
    throw unauthorized('This account has been disabled', 'ACCOUNT_DISABLED');
  }

  await maybeOne(
    `UPDATE users SET last_login_at = now() WHERE id = $1`,
    [user.id],
  );

  const session = await issueSession(user);
  logger.info({ userId: user.id, role: user.role }, 'User logged in');
  res.status(200).json(session);
}

/** POST /api/auth/refresh — rotates the refresh token (reuse = theft signal). */
export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshInput;
  const tokenHash = sha256(refreshToken);

  const session = await withTransaction(async (client) => {
    const row = await maybeOne<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT id, user_id, expires_at, revoked_at
         FROM auth_refresh_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash],
      client,
    );

    if (!row) throw unauthorized('Invalid refresh token', 'INVALID_TOKEN');

    if (row.revoked_at) {
      // A revoked token was presented again: treat it as token theft and
      // revoke every session belonging to this user.
      await client.query(
        `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [row.user_id],
      );
      logger.warn({ userId: row.user_id }, 'Refresh token reuse detected; all sessions revoked');
      throw unauthorized('Refresh token has been revoked', 'INVALID_TOKEN');
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw unauthorized('Refresh token expired', 'TOKEN_EXPIRED');
    }

    await client.query(
      `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE id = $1`,
      [row.id],
    );

    return row;
  });

  const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [session.user_id]);
  if (user.status !== 'ACTIVE') {
    throw unauthorized('This account has been disabled', 'ACCOUNT_DISABLED');
  }

  const newSession = await issueSession(user);
  res.status(200).json(newSession);
}

/** POST /api/auth/logout */
export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshInput;
  await maybeOne(
    `UPDATE auth_refresh_tokens SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(refreshToken)],
  );
  res.status(204).send();
}

/** GET /api/auth/me */
export async function me(req: Request, res: Response): Promise<void> {
  const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [
    req.auth!.userId,
  ]);
  res.status(200).json({ user: publicUser(user) });
}

/** POST /api/auth/change-password */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;

  const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [
    req.auth!.userId,
  ]);

  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw invalidCredentials();
  }

  const newHash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    // A concurrent password change must not overwrite a newer password after
    // both requests validated the same old one.
    const updated = await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3`,
      [newHash, user.id, user.password_hash]);
    if (updated.rowCount !== 1) throw invalidCredentials();
    if (env.PASSWORD_CHANGE_NOTIFICATIONS_ENABLED) {
      await client.query(`INSERT INTO password_change_notifications (subject_user_id, actor_user_id, kind)
        VALUES ($1, $1, 'SELF_CHANGE')`, [user.id]);
    }
    // Force every other session to log in again with the new password.
    await client.query(
      `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
  });

  logger.info({ userId: user.id }, 'Password changed');
  res.status(204).send();
}
