import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import { exportLeadsPdfQuerySchema, exportLeadsQuerySchema, summaryQuerySchema } from './reports.schemas';
import { exportLeadsCsv, exportLeadsPdf, summary } from './reports.service';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

reportsRouter.get('/summary', validate(summaryQuerySchema, 'query'), asyncHandler(summary));
reportsRouter.get('/leads.csv', requireAdmin, validate(exportLeadsQuerySchema, 'query'), asyncHandler(exportLeadsCsv));

reportsRouter.get('/leads.pdf', requireAdmin, validate(exportLeadsPdfQuerySchema, 'query'), asyncHandler(exportLeadsPdf));
