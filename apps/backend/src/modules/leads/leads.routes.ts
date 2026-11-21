import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import {
  addActivitySchema,
  createLeadSchema,
  leadIdParamSchema,
  listActivitiesQuerySchema,
  listLeadsQuerySchema,
  updateLeadSchema,
} from './leads.schemas';
import {
  addActivity,
  createLead,
  deleteLead,
  getLead,
  listActivities,
  listLeads,
  updateLead,
} from './leads.service';
import { createFollowup } from '../followups/followups.service';
import { createFollowupSchema } from '../followups/followups.schemas';

export const leadsRouter = Router();

leadsRouter.use(authenticate);

leadsRouter.get('/', validate(listLeadsQuerySchema, 'query'), asyncHandler(listLeads));
leadsRouter.get('/:id', validate(leadIdParamSchema, 'params'), asyncHandler(getLead));
leadsRouter.post('/', validate(createLeadSchema), asyncHandler(createLead));
leadsRouter.patch('/:id', validate(leadIdParamSchema, 'params'), validate(updateLeadSchema), asyncHandler(updateLead));
leadsRouter.delete('/:id', requireAdmin, validate(leadIdParamSchema, 'params'), asyncHandler(deleteLead));

leadsRouter.get(
  '/:id/activities',
  validate(leadIdParamSchema, 'params'),
  validate(listActivitiesQuerySchema, 'query'),
  asyncHandler(listActivities),
);
leadsRouter.post(
  '/:id/activities',
  validate(leadIdParamSchema, 'params'),
  validate(addActivitySchema),
  asyncHandler(addActivity),
);

// POST /api/v1/leads/:id/followups — schedule a follow-up for a lead.
leadsRouter.post(
  '/:id/followups',
  validate(leadIdParamSchema, 'params'),
  validate(createFollowupSchema),
  asyncHandler(createFollowup),
);
