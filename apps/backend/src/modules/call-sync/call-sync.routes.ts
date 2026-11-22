import { Router } from 'express';
import { env } from '../../config/env';
import { authenticate } from '../../middleware/auth';
import { authenticateDevice } from '../../middleware/deviceAuth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import { createCallEventSchema } from '../call-events/call-events.schemas';
import { createCallEvents } from '../call-events/call-events.service';

/** Dedicated opt-in gate avoids silently sending test calls to an older/live CRM. */
export const callSyncRouter = Router();
callSyncRouter.get('/capability', authenticate, (_req, res) => {
  res.json({ enabled: env.CALL_EVENT_AUTO_CREATE_LEAD });
});
callSyncRouter.post('/events', authenticateDevice, (req, res, next) => {
  if (!env.CALL_EVENT_AUTO_CREATE_LEAD) {
    res.status(503).json({ error: { code: 'SYNC_DISABLED', message: 'Device call sync is disabled' } });
    return;
  }
  next();
}, validate(createCallEventSchema), asyncHandler(createCallEvents));
