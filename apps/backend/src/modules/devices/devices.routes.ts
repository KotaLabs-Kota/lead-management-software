import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import {
  deviceIdParamSchema,
  listDevicesQuerySchema,
  registerDeviceSchema,
} from './devices.schemas';
import { listDevices, registerDevice, revokeDevice } from './devices.service';

export const devicesRouter = Router();

devicesRouter.use(authenticate);

devicesRouter.post('/register', validate(registerDeviceSchema), asyncHandler(registerDevice));
devicesRouter.get('/', validate(listDevicesQuerySchema, 'query'), asyncHandler(listDevices));
devicesRouter.post(
  '/:id/revoke',
  requireAdmin,
  validate(deviceIdParamSchema, 'params'),
  asyncHandler(revokeDevice),
);
