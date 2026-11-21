import { z } from 'zod';

export const createFollowupSchema = z.object({
  dueAt: z.string().datetime({ offset: true }),
  assignedUserId: z.string().uuid('assignedUserId must be a UUID').optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const completeFollowupSchema = z.object({
  completionNotes: z.string().trim().max(1000).optional(),
});

export const cancelFollowupSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const listFollowupsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED', 'MISSED']).optional(),
  assignedUserId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  /** Only follow-ups due before this timestamp (defaults to now). */
  overdue: z.enum(['true', 'false']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const followupIdParamSchema = z.object({
  id: z.string().uuid('id must be a UUID'),
});

export type CreateFollowupInput = z.infer<typeof createFollowupSchema>;
export type CompleteFollowupInput = z.infer<typeof completeFollowupSchema>;
export type CancelFollowupInput = z.infer<typeof cancelFollowupSchema>;
export type ListFollowupsQuery = z.infer<typeof listFollowupsQuerySchema>;
