import { z } from 'zod';
import { USER_ROLES, USER_STATUSES } from '../../types/domain';

export const createUserSchema = z.object({
  email: z.string().trim().email('A valid email address is required'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128, 'Password must be at most 128 characters'),
  name: z.string().trim().min(2, 'Name is required').max(120),
  role: z.enum(USER_ROLES).default('EMPLOYEE'),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters')
      .max(128, 'Password must be at most 128 characters')
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listUsersQuerySchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('id must be a UUID'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
