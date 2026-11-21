import type { NextFunction, Request, Response } from 'express';
import { maybeOne } from '../db/pool';
import { unauthorized } from '../utils/errors';
import { safeEqual, sha256 } from '../utils/tokens';

export interface DeviceContext {
  deviceId: string;
  userId: string;
  deviceName: string;
}

interface DeviceRow {
  id: string;
  user_id: string;
  device_name: string;
  token_hash: string;
  status: 'ACTIVE' | 'REVOKED';
  user_status: 'ACTIVE' | 'DISABLED';
}

/**
 * Authenticate an Android device using its long-lived bearer token:
 *   `Authorization: Bearer dvc_...`
 *
 * Device tokens are separate from user JWTs on purpose: a lost phone can be
 * revoked without invalidating the employee's web session, and the Android app
 * never holds a password.
 *
 * Only the SHA-256 hash is compared against the database.
 */
export async function authenticateDevice(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      throw unauthorized('Missing device token');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token.startsWith('dvc_')) {
      throw unauthorized('Invalid device token', 'INVALID_TOKEN');
    }

    const device = await maybeOne<DeviceRow>(
      `SELECT d.id, d.user_id, d.device_name, d.token_hash, d.status, u.status AS user_status
         FROM devices d
         JOIN users u ON u.id = d.user_id
        WHERE d.token_hash = $1`,
      [sha256(token)],
    );

    if (!device || !safeEqual(device.token_hash, sha256(token))) {
      throw unauthorized('Invalid device token', 'INVALID_TOKEN');
    }
    if (device.status === 'REVOKED') {
      throw unauthorized('This device has been revoked', 'DEVICE_REVOKED');
    }
    if (device.user_status !== 'ACTIVE') {
      throw unauthorized('The employee account for this device is disabled', 'ACCOUNT_DISABLED');
    }

    req.device = { deviceId: device.id, userId: device.user_id, deviceName: device.device_name };

    // Best-effort "last seen" tracking — never block the request on it.
    void maybeOne(
      `UPDATE devices SET last_seen_at = now() WHERE id = $1`,
      [device.id],
    ).catch(() => undefined);

    next();
  } catch (error) {
    next(error);
  }
}
