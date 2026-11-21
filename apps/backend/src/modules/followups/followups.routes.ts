import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import {
  cancelFollowupSchema,
  completeFollowupSchema,
  followupIdParamSchema,
  listFollowupsQuerySchema,
} from './followups.schemas';
import { cancelFollowup, completeFollowup, listFollowups } from './followups.service';

export const followupsRouter = Router();

followupsRouter.use(authenticate);

followupsRouter.get('/', validate(listFollowupsQuerySchema, 'query'), asyncHandler(listFollowups));
followupsRouter.post(
  '/:id/complete',
  validate(followupIdParamSchema, 'params'),
  validate(completeFollowupSchema),
  asyncHandler(completeFollowup),
);
followupsRouter.post(
  '/:id/cancel',
  validate(followupIdParamSchema, 'params'),
  validate(cancelFollowupSchema),
  asyncHandler(cancelFollowup),
);
