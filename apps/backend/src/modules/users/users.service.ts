import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { many, maybeOne, one, withTransaction } from '../../db/pool';
import { logger } from '../../lib/logger';
import { conflict, notFound } from '../../utils/errors';
import { hashPassword } from '../../utils/password';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './users.schemas';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'EMPLOYEE';
  status: 'ACTIVE' | 'DISABLED';
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  lead_count: number;
  device_count: number;
}

const SELECT_USER = `
  SELECT u.id, u.email, u.name, u.role, u.status, u.last_login_at, u.created_at, u.updated_at,
         (SELECT COUNT(*) FROM leads l WHERE l.assigned_user_id = u.id) AS lead_count,
         (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id AND d.status = 'ACTIVE') AS device_count
    FROM users u`;

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lastLoginAt: user.last_login_at,
    leadCount: user.lead_count,
    deviceCount: user.device_count,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/** GET /api/v1/users — admin only */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListUsersQuery;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.role) {
    params.push(query.role);
    conditions.push(`u.role = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`u.status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const users = await many<UserRow>(`${SELECT_USER} ${where} ORDER BY u.created_at DESC`, params);

  res.status(200).json({ users: users.map(publicUser) });
}

/** GET /api/v1/users/:id — admin only */
export async function getUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const user = await maybeOne<UserRow>(`${SELECT_USER} WHERE u.id = $1`, [id]);
  if (!user) throw notFound('User');
  res.status(200).json({ user: publicUser(user) });
}

/** POST /api/v1/users — admin only */
export async function createUser(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateUserInput;

  const existing = await maybeOne<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = lower($1)`,
    [input.email],
  );
  if (existing) throw conflict('An account with this email already exists');

  const passwordHash = await hashPassword(input.password);

  const user = await one<UserRow>(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, role, status, last_login_at, created_at, updated_at, 0 AS lead_count, 0 AS device_count`,
    [input.email, passwordHash, input.name, input.role],
  );

  logger.info({ userId: user.id, role: user.role }, 'User created by admin');
  res.status(201).json({ user: publicUser(user) });
}

/** PATCH /api/v1/users/:id — admin only */
export async function updateUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as UpdateUserInput;

  const existing = await maybeOne<UserRow>(`${SELECT_USER} WHERE u.id = $1`, [id]);
  if (!existing) throw notFound('User');

  // Safety rule: never let the last active admin be demoted or disabled.
  if (existing.role === 'ADMIN' && existing.status === 'ACTIVE') {
    const demoting = input.role !== undefined && input.role !== 'ADMIN';
    const disabling = input.status !== undefined && input.status !== 'ACTIVE';
    if (demoting || disabling) {
      const otherAdmins = await maybeOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1`,
        [id],
      );
      if (!otherAdmins || otherAdmins.count === 0) {
        throw conflict('Cannot demote or disable the last active admin');
      }
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (input.name !== undefined) push('name', input.name);
  if (input.role !== undefined) push('role', input.role);
  if (input.status !== undefined) push('status', input.status);
  if (input.password !== undefined) push('password_hash', await hashPassword(input.password));

  params.push(id);
  // Password, token revocation and metadata-only notification commit together.
  const user = await withTransaction(async (client) => {
    const updated = await one<UserRow>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, email, name, role, status, last_login_at, created_at, updated_at,
                 (SELECT COUNT(*) FROM leads l WHERE l.assigned_user_id = users.id) AS lead_count,
                 (SELECT COUNT(*) FROM devices d WHERE d.user_id = users.id AND d.status = 'ACTIVE') AS device_count`,
      params, client,
    );
    if (input.password !== undefined || input.status === 'DISABLED') {
      await client.query(
        `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id],
      );
    }
    if (input.password !== undefined && env.PASSWORD_CHANGE_NOTIFICATIONS_ENABLED) {
      await client.query(`INSERT INTO password_change_notifications (subject_user_id, actor_user_id, kind)
        VALUES ($1, $2, 'ADMIN_RESET')`, [id, req.auth!.userId]);
    }
    return updated;
  });

  logger.info({ userId: id, updatedFields: Object.keys(input) }, 'User updated by admin');
  res.status(200).json({ user: publicUser(user) });
}

/** DELETE /api/v1/users/:id — admin only. Soft delete (disable) to preserve lead history. */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };

  if (id === req.auth!.userId) {
    throw conflict('You cannot delete your own account');
  }

  const existing = await maybeOne<UserRow>(`${SELECT_USER} WHERE u.id = $1`, [id]);
  if (!existing) throw notFound('User');

  if (existing.role === 'ADMIN' && existing.status === 'ACTIVE') {
    const otherAdmins = await maybeOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> $1`,
      [id],
    );
    if (!otherAdmins || otherAdmins.count === 0) {
      throw conflict('Cannot delete the last active admin');
    }
  }

  await withTransaction(async (client) => {
    await client.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [id]);
    await client.query(
      `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [id],
    );
    // Revoke the employee's devices so a deleted account cannot keep syncing.
    await client.query(
      `UPDATE devices SET status = 'REVOKED', revoked_at = now() WHERE user_id = $1 AND status = 'ACTIVE'`,
      [id],
    );
  });

  logger.info({ userId: id }, 'User disabled (soft delete) by admin');
  res.status(204).send();
}
