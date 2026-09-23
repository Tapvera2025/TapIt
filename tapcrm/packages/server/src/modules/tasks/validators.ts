import { z } from 'zod';

export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const taskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

export const createTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Task title is required')
    .max(255, 'Task title must be 255 characters or fewer'),
  description: z.string().trim().max(10000).optional().nullable(),
  projectId: z.string().uuid('Invalid project ID format').optional().nullable(),
  assigneeIds: z.array(z.string().uuid('Invalid assignee ID format')).optional().default([]),
  dueDate: z.coerce.date().optional().nullable(),
  priority: taskPrioritySchema.optional().default('medium'),
});

export const updateTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Task title cannot be empty')
    .max(255, 'Task title must be 255 characters or fewer')
    .optional(),
  description: z.string().trim().max(10000).optional().nullable(),
  projectId: z.string().uuid('Invalid project ID format').optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  priority: taskPrioritySchema.optional(),
});

export const transitionTaskSchema = z.object({
  status: taskStatusSchema,
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const assignTaskSchema = z.object({
  assigneeIds: z.array(z.string().uuid('Invalid assignee ID format')),
});

export const taskListQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z
      .enum(['all', 'pending', 'in_progress', 'completed', 'cancelled'])
      .optional()
      .default('all'),
    priority: z
      .enum(['all', 'low', 'medium', 'high', 'urgent'])
      .optional()
      .default('all'),
    datePreset: z
      .enum(['all', 'today', 'this_month', 'overdue', 'custom'])
      .optional()
      .default('all'),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    projectId: z.string().uuid().optional(),
    assigneeId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z
      .enum(['dueDate', 'createdAt', 'title', 'priority', 'status'])
      .default('dueDate'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  })
  .refine(
    (data) => {
      if (data.datePreset === 'custom') {
        if (!data.startDate || !data.endDate) {
          return false;
        }
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: 'startDate must be before or equal to endDate for custom datePreset',
      path: ['startDate'],
    },
  );

export const taskAssigneesQuerySchema = z.object({
  projectId: z.string().uuid('Invalid project ID format').optional(),
  search: z.string().trim().max(100).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TransitionTaskInput = z.infer<typeof transitionTaskSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;
export type TaskListQueryInput = z.infer<typeof taskListQuerySchema>;
export type TaskAssigneesQueryInput = z.infer<typeof taskAssigneesQuerySchema>;

