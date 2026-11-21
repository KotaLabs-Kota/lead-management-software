import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import { exportLeadsQuerySchema, summaryQuerySchema } from './reports.schemas';
import { exportLeadsCsv, summary } from './reports.service';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

reportsRouter.get('/summary', validate(summaryQuerySchema, 'query'), asyncHandler(summary));
reportsRouter.get('/leads.csv', validate(exportLeadsQuerySchema, 'query'), asyncHandler(exportLeadsCsv));
