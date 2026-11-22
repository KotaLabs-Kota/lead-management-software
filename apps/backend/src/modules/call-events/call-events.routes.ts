import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { authenticateDevice } from '../../middleware/deviceAuth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import { createCallEventSchema, listCallEventsQuerySchema } from './call-events.schemas';
import { createCallEvents, listCallEvents } from './call-events.service';

/**
 * Call events accept two kinds of credentials:
 *  - a user JWT (manual logging from the web CRM)
 *  - a device token (Android sync)
 * The first authenticator that succeeds wins.
 */
function authenticateEither(req: Parameters<typeof authenticate>[0], res: Parameters<typeof authenticate>[1], next: Parameters<typeof authenticate>[2]): void {
  authenticate(req, res, (userError) => {
    if (!userError) return next();
    authenticateDevice(req, res, (deviceError) => {
      if (!deviceError) return next();
      // Report the user-auth error (more informative for web clients).
      next(req.header('authorization')?.startsWith('Bearer dvc_') ? deviceError : userError);
    });
  });
}

export const callEventsRouter = Router();

callEventsRouter.post('/', authenticateEither, validate(createCallEventSchema), asyncHandler(createCallEvents));
callEventsRouter.get('/', authenticate, validate(listCallEventsQuerySchema, 'query'), asyncHandler(listCallEvents));
