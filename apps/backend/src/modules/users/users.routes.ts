import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userIdParamSchema,
} from './users.schemas';
import { createUser, deleteUser, getUser, listUsers, updateUser } from './users.service';

export const usersRouter = Router();

usersRouter.use(authenticate, requireAdmin);

usersRouter.get('/', validate(listUsersQuerySchema, 'query'), asyncHandler(listUsers));
usersRouter.get('/:id', validate(userIdParamSchema, 'params'), asyncHandler(getUser));
usersRouter.post('/', validate(createUserSchema), asyncHandler(createUser));
usersRouter.patch('/:id', validate(userIdParamSchema, 'params'), validate(updateUserSchema), asyncHandler(updateUser));
usersRouter.delete('/:id', validate(userIdParamSchema, 'params'), asyncHandler(deleteUser));
