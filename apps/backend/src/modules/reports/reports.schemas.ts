import { z } from 'zod';
import { LEAD_SOURCES, LEAD_STATUSES } from '../../types/domain';

export const summaryQuerySchema = z.object({
  /** ISO date (YYYY-MM-DD). Defaults to today, evaluated in Asia/Kolkata. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
  /** Restrict to one employee (admin only). */
  userId: z.string().uuid().optional(),
});

export const exportLeadsQuerySchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  assignedUserId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  /** Hard cap so a single export cannot exhaust memory. */
  limit: z.coerce.number().int().min(1).max(10000).default(5000),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});

export const exportLeadsPdfQuerySchema = exportLeadsQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type ExportLeadsQuery = z.infer<typeof exportLeadsQuerySchema>;
