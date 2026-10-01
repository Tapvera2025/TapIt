import { z } from 'zod';
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from '@tapcrm/contracts';

export const listEmployeeNotesFilterSchema = z.object({
  department: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});

export const userIdParamSchema = z.object({
  userId: z.string().uuid({ message: 'Invalid user ID' }),
});

export const employeeHistoryParamsSchema = z.object({
  userId: z.string().uuid({ message: 'Invalid user ID' }),
  historyId: z.string().uuid({ message: 'Invalid history ID' }),
});

export type ValidatedListEmployeeNotesFilter = z.infer<typeof listEmployeeNotesFilterSchema>;
export type ValidatedUserIdParam = z.infer<typeof userIdParamSchema>;
export type ValidatedEmployeeHistoryParams = z.infer<typeof employeeHistoryParamsSchema>;
