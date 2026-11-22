import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { maybeOne, pool, type Queryable } from '../../db/pool';
import { AppError } from '../../utils/errors';

// This feature is opt-in; configure only after applying the migration.
export async function enforceServiceAccess(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (env.OWNER_CONTROLS_ENABLED) {
      const state = await maybeOne<{ suspended: boolean }>('SELECT suspended FROM owner_service_control WHERE singleton = true');
      if (!state || state.suspended) throw new AppError(503, 'SERVICE_SUSPENDED', 'CRM access is suspended. Please contact your service provider.');
    }
    next();
  } catch (error) { next(error); }
}

export async function enforceOwnerAccountBlock(userId: string, db: Queryable = pool): Promise<void> {
  if (!env.OWNER_CONTROLS_ENABLED) return;
  const blocked = await maybeOne<{ user_id: string }>('SELECT user_id FROM owner_blocked_accounts WHERE user_id = $1', [userId], db);
  // 503 lets Android retry instead of treating a temporary owner block as a permanently revoked device.
  if (blocked) throw new AppError(503, 'OWNER_ACCOUNT_BLOCKED', 'Account access is suspended. Please contact your service provider.');
}
