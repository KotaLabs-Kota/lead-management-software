import { z } from 'zod';
import {
  ACTIVITY_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
} from '../../types/domain';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const createLeadSchema = z.object({
  customerName: z.string().trim().min(1, 'customerName is required').max(160),
  phone: z.string().trim().min(7, 'A valid phone number is required').max(30),
  alternatePhone: z.string().trim().min(7).max(30).optional(),
  email: z.string().trim().email('A valid email address is required').optional(),
  city: optionalText(120),
  vehicleType: optionalText(120),
  vehicleDetails: optionalText(500),
  requirement: optionalText(1000),
  source: z.enum(LEAD_SOURCES).default('MANUAL'),
  sourceDetail: optionalText(255),
  assignedUserId: z.string().uuid('assignedUserId must be a UUID').nullable().optional(),
  notes: optionalText(2000),
});

export const updateLeadSchema = z
  .object({
    customerName: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().min(7).max(30).optional(),
    alternatePhone: z.string().trim().min(7).max(30).nullable().optional(),
    email: z.string().trim().email('A valid email address is required').nullable().optional(),
    city: optionalText(120),
    vehicleType: optionalText(120),
    vehicleDetails: optionalText(500),
    requirement: optionalText(1000),
    source: z.enum(LEAD_SOURCES).optional(),
    assignedUserId: z.string().uuid('assignedUserId must be a UUID').nullable().optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    lostReason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(
    (value) => value.status !== 'LOST' || (value.lostReason !== undefined && value.lostReason !== null && value.lostReason.trim() !== ''),
    { message: 'lostReason is required when status is LOST', path: ['lostReason'] },
  );

export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  assignedUserId: z.string().uuid().optional(),
  unassigned: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(120).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'updated_desc', 'followup_asc']).default('created_desc'),
});

export const leadIdParamSchema = z.object({
  id: z.string().uuid('id must be a UUID'),
});

export const addActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES).default('NOTE'),
  body: z.string().trim().min(1, 'body is required').max(2000),
});

export const listActivitiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
export type AddActivityInput = z.infer<typeof addActivitySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;
