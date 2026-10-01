import { z } from 'zod';

export const MAX_TODO_TITLE_LENGTH = 500;
export const MAX_TODO_DESCRIPTION_LENGTH = 5000;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const createTodoSchema = z
  .object({
    title: z
      .string({ required_error: 'Title is required' })
      .trim()
      .min(1, 'Title cannot be empty')
      .max(
        MAX_TODO_TITLE_LENGTH,
        `Title must not exceed ${MAX_TODO_TITLE_LENGTH} characters`,
      ),
    description: z
      .string()
      .trim()
      .max(
        MAX_TODO_DESCRIPTION_LENGTH,
        `Description must not exceed ${MAX_TODO_DESCRIPTION_LENGTH} characters`,
      )
      .nullable()
      .optional(),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    scheduledDate: z
      .string()
      .regex(dateRegex, 'Scheduled date must be in YYYY-MM-DD format')
      .nullable()
      .optional(),
    dueTime: z
      .string()
      .regex(timeRegex, 'Due time must be in HH:mm or HH:mm:ss format')
      .nullable()
      .optional(),
  })
  .strict();

export const updateTodoSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title cannot be empty')
      .max(
        MAX_TODO_TITLE_LENGTH,
        `Title must not exceed ${MAX_TODO_TITLE_LENGTH} characters`,
      )
      .optional(),
    description: z
      .string()
      .trim()
      .max(
        MAX_TODO_DESCRIPTION_LENGTH,
        `Description must not exceed ${MAX_TODO_DESCRIPTION_LENGTH} characters`,
      )
      .nullable()
      .optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    scheduledDate: z
      .string()
      .regex(dateRegex, 'Scheduled date must be in YYYY-MM-DD format')
      .nullable()
      .optional(),
    dueTime: z
      .string()
      .regex(timeRegex, 'Due time must be in HH:mm or HH:mm:ss format')
      .nullable()
      .optional(),
    status: z.enum(['pending', 'completed']).optional(),
  })
  .strict();

export const todoIdParamSchema = z
  .object({
    id: z.string().uuid('Invalid Todo ID'),
  })
  .strict();

export const listTodosQuerySchema = z
  .object({
    status: z.enum(['pending', 'completed']).optional(),
    scheduledDate: z
      .string()
      .regex(dateRegex, 'Scheduled date filter must be in YYYY-MM-DD format')
      .optional(),
  })
  .strict();

export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
export type TodoIdParam = z.infer<typeof todoIdParamSchema>;
export type ListTodosQuery = z.infer<typeof listTodosQuerySchema>;
