import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { many, maybeOne, one } from '../../db/pool';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { notFound } from '../../utils/errors';
import { asyncHandler } from '../../utils/http';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate, requireAdmin);
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) });
const idSchema = z.object({ id: z.string().uuid() });
const pageSize = 20;

notificationsRouter.get('/', validate(pageSchema, 'query'), asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!env.PASSWORD_CHANGE_NOTIFICATIONS_ENABLED) {
    res.json({ enabled: false, notifications: [], unreadCount: 0, hasMore: false });
    return;
  }
  const page = Number(req.query.page ?? 1);
  const adminId = req.auth!.userId;
  const rows = await many<{
    id: string; subject_name: string | null; actor_name: string | null;
    kind: 'SELF_CHANGE' | 'ADMIN_RESET'; created_at: Date; read: boolean;
  }>(`SELECT n.id, subject.name AS subject_name, actor.name AS actor_name, n.kind, n.created_at,
             (r.notification_id IS NOT NULL) AS read
        FROM password_change_notifications n
        LEFT JOIN users subject ON subject.id = n.subject_user_id
        LEFT JOIN users actor ON actor.id = n.actor_user_id
        LEFT JOIN password_notification_reads r ON r.notification_id = n.id AND r.admin_user_id = $1
       ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3`, [adminId, pageSize + 1, (page - 1) * pageSize]);
  const count = await one<{ unread: number }>(
    `SELECT COUNT(*) AS unread FROM password_change_notifications n
      WHERE NOT EXISTS (SELECT 1 FROM password_notification_reads r
        WHERE r.notification_id = n.id AND r.admin_user_id = $1)`, [adminId]);
  res.json({ enabled: true, page, hasMore: rows.length > pageSize, unreadCount: count.unread,
    notifications: rows.slice(0, pageSize).map((row) => ({ id: row.id, subjectName: row.subject_name,
      actorName: row.actor_name, kind: row.kind, createdAt: row.created_at, read: row.read })) });
}));

notificationsRouter.post('/:id/read', validate(idSchema, 'params'), asyncHandler(async (req, res) => {
  if (!env.PASSWORD_CHANGE_NOTIFICATIONS_ENABLED) throw notFound('Notification');
  const row = await maybeOne<{ id: string }>(
    `INSERT INTO password_notification_reads (notification_id, admin_user_id)
     SELECT id, $2 FROM password_change_notifications WHERE id = $1
     ON CONFLICT (notification_id, admin_user_id) DO UPDATE SET read_at = password_notification_reads.read_at
     RETURNING notification_id AS id`, [req.params.id, req.auth!.userId]);
  if (!row) throw notFound('Notification');
  res.status(204).send();
}));
