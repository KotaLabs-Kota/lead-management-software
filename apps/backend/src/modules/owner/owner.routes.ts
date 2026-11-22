import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { many, maybeOne, withTransaction } from '../../db/pool';
import { AppError, notFound, unauthorized } from '../../utils/errors';
import { asyncHandler } from '../../utils/http';
import { safeEqual, sha256 } from '../../utils/tokens';
import { validate } from '../../middleware/validate';
import { hashPassword, verifyPassword } from '../../utils/password';
import { issueOwnerSession, validOwnerSession } from './owner-password';

export const ownerRouter = Router();
// Rate limits are per backend instance; use an edge/shared limiter in production.
ownerRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));
ownerRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const passwordSchema = z.object({ password: z.string().min(12).max(128).refine((value) => value.trim().length >= 12, 'Use at least 12 non-padding characters') }).strict();
const loginSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const passwordAttempts = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) => { res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } }); },
});

// Passwords never appear in URLs. The short-lived session is returned once and
// remains in browser memory; the recovery key is not returned to the browser.
ownerRouter.post('/login', passwordAttempts, validate(loginSchema), asyncHandler(async (req, res) => {
  if (!env.OWNER_CONTROLS_ENABLED || !env.OWNER_PASSWORD_LOGIN_ENABLED || !env.OWNER_CONTROL_KEY) throw notFound('Route');
  const row = await maybeOne<{ password_hash: string }>('SELECT password_hash FROM owner_password_login WHERE singleton = true');
  if (!row || !(await verifyPassword(req.body.password as string, row.password_hash))) throw unauthorized('Invalid owner password');
  res.json({ token: issueOwnerSession(row.password_hash), expiresIn: 900 });
}));

// No authentication metadata is sent to logs or client request headers.
const ownerCredentials = new WeakMap<object, 'key' | 'password'>();
ownerRouter.use(asyncHandler(async (req, _res, next) => {
  if (!env.OWNER_CONTROLS_ENABLED || !env.OWNER_CONTROL_KEY) throw notFound('Route');
  const header = req.header('authorization') ?? '';
  const credential = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (safeEqual(sha256(credential), sha256(env.OWNER_CONTROL_KEY))) {
    ownerCredentials.set(req, 'key');
    return next();
  }
  if (env.OWNER_PASSWORD_LOGIN_ENABLED) {
    const row = await maybeOne<{ password_hash: string }>('SELECT password_hash FROM owner_password_login WHERE singleton = true');
    if (row && validOwnerSession(credential, row.password_hash)) {
      ownerCredentials.set(req, 'password');
      return next();
    }
  }
  throw unauthorized('Owner authentication required');
}));
// Only the independent recovery key can set/reset the password; an ordinary
// password session cannot lock out the owner by changing the credential.
ownerRouter.put('/password', validate(passwordSchema), asyncHandler(async (req, res) => {
  if (!env.OWNER_PASSWORD_LOGIN_ENABLED) throw notFound('Route');
  if (ownerCredentials.get(req) !== 'key') throw unauthorized('Recovery key required');
  const hash = await hashPassword(req.body.password as string);
  await withTransaction(async (db) => {
    await db.query(`INSERT INTO owner_password_login (singleton, password_hash) VALUES (true, $1)
      ON CONFLICT (singleton) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`, [hash]);
    await db.query("INSERT INTO owner_control_audit (action) VALUES ('PASSWORD_SET')");
  });
  res.json({ updated: true });
}));

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
  res.json({ suspended: state.suspended, updatedAt: state.updated_at, admins,
    passwordLoginEnabled: env.OWNER_PASSWORD_LOGIN_ENABLED, credentialType: ownerCredentials.get(_req) });
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
