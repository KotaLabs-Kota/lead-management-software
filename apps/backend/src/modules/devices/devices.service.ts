import type { Request, Response } from 'express';
import { many, maybeOne, one } from '../../db/pool';
import { logger } from '../../lib/logger';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { generateOpaqueToken, DEVICE_TOKEN_PREFIX, sha256 } from '../../utils/tokens';
import type { ListDevicesQuery, RegisterDeviceInput } from './devices.schemas';

interface DeviceRow {
  id: string;
  user_id: string;
  device_code: string;
  device_name: string | null;
  manufacturer: string | null;
  model: string | null;
  android_version: string | null;
  app_version: string | null;
  status: 'ACTIVE' | 'REVOKED';
  last_seen_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
  user_name: string;
  user_email: string;
}

const SELECT_DEVICE = `
  SELECT d.id, d.user_id, d.device_code, d.device_name, d.manufacturer, d.model,
         d.android_version, d.app_version, d.status, d.last_seen_at, d.created_at, d.revoked_at,
         u.name AS user_name, u.email AS user_email
    FROM devices d
    JOIN users u ON u.id = d.user_id`;

function publicDevice(device: DeviceRow) {
  return {
    id: device.id,
    userId: device.user_id,
    userName: device.user_name,
    userEmail: device.user_email,
    deviceCode: device.device_code,
    deviceName: device.device_name,
    manufacturer: device.manufacturer,
    model: device.model,
    androidVersion: device.android_version,
    appVersion: device.app_version,
    status: device.status,
    lastSeenAt: device.last_seen_at,
    registeredAt: device.created_at,
    revokedAt: device.revoked_at,
  };
}

/**
 * POST /api/v1/devices/register
 *
 * Registers an Android phone and returns its device token ONCE. The token is
 * stored only as a hash, so it can never be recovered from the database —
 * losing it means registering the device again.
 */
export async function registerDevice(req: Request, res: Response): Promise<void> {
  const input = req.body as RegisterDeviceInput;

  // Employees may only register a device for themselves.
  const targetUserId = input.userId ?? req.auth!.userId;
  if (req.auth!.role !== 'ADMIN' && targetUserId !== req.auth!.userId) {
    throw forbidden('Employees can only register devices for themselves');
  }

  const user = await maybeOne<{ id: string; status: string }>(
    `SELECT id, status FROM users WHERE id = $1`,
    [targetUserId],
  );
  if (!user) throw notFound('User');
  if (user.status !== 'ACTIVE') throw conflict('Cannot register a device for a disabled account');

  const existing = await maybeOne<{ id: string; status: string }>(
    `SELECT id, status FROM devices WHERE user_id = $1 AND device_code = $2`,
    [targetUserId, input.deviceCode],
  );
  if (existing && existing.status === 'ACTIVE') {
    throw conflict('This device is already registered for this employee');
  }

  const token = generateOpaqueToken(DEVICE_TOKEN_PREFIX);

  const device = await one<DeviceRow>(
    `INSERT INTO devices (
       user_id, device_code, device_name, manufacturer, model,
       android_version, app_version, token_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, device_code, device_name, manufacturer, model,
               android_version, app_version, status, last_seen_at, created_at, revoked_at,
               (SELECT name FROM users WHERE id = $1) AS user_name,
               (SELECT email FROM users WHERE id = $1) AS user_email`,
    [
      targetUserId,
      input.deviceCode,
      input.deviceName,
      input.manufacturer ?? null,
      input.model ?? null,
      input.androidVersion ?? null,
      input.appVersion ?? null,
      sha256(token),
    ],
  );

  logger.info({ deviceId: device.id, userId: targetUserId }, 'Device registered');
  res.status(201).json({
    device: publicDevice(device),
    // Shown exactly once. The Android app must store it in encrypted storage.
    deviceToken: token,
  });
}

/** GET /api/v1/devices — admin sees all, employees see their own. */
export async function listDevices(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListDevicesQuery;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (req.auth!.role !== 'ADMIN') {
    params.push(req.auth!.userId);
    conditions.push(`d.user_id = $${params.length}`);
  } else if (query.userId) {
    params.push(query.userId);
    conditions.push(`d.user_id = $${params.length}`);
  }

  if (query.status) {
    params.push(query.status);
    conditions.push(`d.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const devices = await many<DeviceRow>(
    `${SELECT_DEVICE} ${where} ORDER BY d.created_at DESC`,
    params,
  );

  res.status(200).json({ devices: devices.map(publicDevice) });
}

/** POST /api/v1/devices/:id/revoke — admin only. */
export async function revokeDevice(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };

  const device = await maybeOne<DeviceRow>(`${SELECT_DEVICE} WHERE d.id = $1`, [id]);
  if (!device) throw notFound('Device');
  if (device.status === 'REVOKED') throw conflict('Device is already revoked');

  const updated = await one<DeviceRow>(
    `UPDATE devices SET status = 'REVOKED', revoked_at = now()
      WHERE id = $1
      RETURNING id, user_id, device_code, device_name, manufacturer, model,
                android_version, app_version, status, last_seen_at, created_at, revoked_at,
                (SELECT name FROM users WHERE id = devices.user_id) AS user_name,
                (SELECT email FROM users WHERE id = devices.user_id) AS user_email`,
    [id],
  );

  logger.warn({ deviceId: id, userId: updated.user_id }, 'Device revoked by admin');
  res.status(200).json({ device: publicDevice(updated) });
}

/** Device can revoke its own credential before removing its local data. */
export async function revokeOwnDevice(req: Request, res: Response): Promise<void> {
  await maybeOne(
    `UPDATE devices SET status = 'REVOKED', revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [req.device!.deviceId, req.device!.userId],
  );
  res.status(204).send();
}
