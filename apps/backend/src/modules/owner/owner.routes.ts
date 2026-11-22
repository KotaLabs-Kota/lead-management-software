import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { many, maybeOne, withTransaction } from '../../db/pool';
import { AppError, notFound, unauthorized } from '../../utils/errors';
import { asyncHandler } from '../../utils/http';
import { safeEqual, sha256 } from '../../utils/tokens';
import { validate } from '../../middleware/validate';

export const ownerRouter = Router();
// Rate limits are per backend instance; use an edge/shared limiter in production.
ownerRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));
ownerRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!env.OWNER_CONTROLS_ENABLED || !env.OWNER_CONTROL_KEY) return next(notFound('Route'));
  const header = req.header('authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!safeEqual(sha256(key), sha256(env.OWNER_CONTROL_KEY))) return next(unauthorized('Owner authentication required'));
  next();
});

const serviceSchema = z.object({ suspended: z.boolean() }).strict();
const accountSchema = z.object({ blocked: z.boolean() }).strict();
const idSchema = z.object({ id: z.string().uuid() });

ownerRouter.get('/status', asyncHandler(async (_req, res) => {
  const state = await maybeOne<{ suspended: boolean; updated_at: Date }>(
    'SELECT suspended, updated_at FROM owner_service_control WHERE singleton = true',
  );
  if (!state) throw new AppError(503, 'SERVICE_SUSPENDED', 'Owner controls are unavailable');
  const admins = await many<{ id: string; name: string; email: string; role: string; status: string; blocked: boolean }>(
    `SELECT u.id, u.name, u.email, u.role, u.status, (b.user_id IS NOT NULL) AS blocked
       FROM users u LEFT JOIN owner_blocked_accounts b ON b.user_id = u.id
      WHERE u.role = 'ADMIN' OR b.user_id IS NOT NULL ORDER BY u.name, u.id`,
  );
  res.json({ suspended: state.suspended, updatedAt: state.updated_at, admins });
}));

ownerRouter.put('/service', validate(serviceSchema), asyncHandler(async (req, res) => {
  const { suspended } = req.body as z.infer<typeof serviceSchema>;
  await withTransaction(async (db) => {
    const state = await maybeOne<{ suspended: boolean }>(
      'SELECT suspended FROM owner_service_control WHERE singleton = true FOR UPDATE', [], db,
    );
    if (!state) throw new AppError(503, 'SERVICE_SUSPENDED', 'Owner controls are unavailable');
    if (state.suspended !== suspended) {
      await db.query('UPDATE owner_service_control SET suspended = $1, updated_at = now() WHERE singleton = true', [suspended]);
      await db.query('INSERT INTO owner_control_audit (action) VALUES ($1)', [suspended ? 'SERVICE_SUSPENDED' : 'SERVICE_RESUMED']);
    }
  });
  res.json({ suspended });
}));

ownerRouter.put('/admins/:id', validate(idSchema, 'params'), validate(accountSchema), asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const { blocked } = req.body as z.infer<typeof accountSchema>;
  await withTransaction(async (db) => {
    const user = await maybeOne<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = $1 FOR UPDATE', [id], db);
    if (!user) throw notFound('Account');
    // A previously blocked account can still be unblocked if its role changed.
    const existing = await maybeOne<{ user_id: string }>('SELECT user_id FROM owner_blocked_accounts WHERE user_id = $1', [id], db);
    if (blocked && user.role !== 'ADMIN') throw notFound('Admin');
    if (blocked && !existing) {
      await db.query('INSERT INTO owner_blocked_accounts (user_id) VALUES ($1)', [id]);
      await db.query('UPDATE auth_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      await db.query("INSERT INTO owner_control_audit (action, target_user_id) VALUES ('ADMIN_BLOCKED', $1)", [id]);
    } else if (!blocked && existing) {
      await db.query('DELETE FROM owner_blocked_accounts WHERE user_id = $1', [id]);
      await db.query("INSERT INTO owner_control_audit (action, target_user_id) VALUES ('ADMIN_UNBLOCKED', $1)", [id]);
    }
  });
  res.json({ blocked });
}));
