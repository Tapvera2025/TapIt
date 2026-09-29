import { describe, expect, it } from 'vitest';
import {
  assignTaskSchema,
  createTaskSchema,
  taskListQuerySchema,
  transitionTaskSchema,
  updateTaskSchema,
} from './validators.js';

describe('Task validators', () => {
  describe('createTaskSchema', () => {
    it('accepts a valid minimal task creation input', () => {
      const result = createTaskSchema.safeParse({
        title: 'Fix issue with login',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Fix issue with login');
        expect(result.data.priority).toBe('medium');
        expect(result.data.assigneeIds).toEqual([]);
      }
    });

    it('accepts a fully populated task creation input', () => {
      const result = createTaskSchema.safeParse({
        title: 'Complete project documentation',
        description: 'Provide comprehensive markdown files.',
        projectId: '00000000-0000-0000-0000-000000000001',
        priority: 'urgent',
        assigneeIds: ['00000000-0000-0000-0000-000000000002'],
        dueDate: '2026-12-31T23:59:59.000Z',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe('urgent');
        expect(result.data.dueDate).toBeInstanceOf(Date);
        expect(result.data.assigneeIds).toHaveLength(1);
      }
    });

    it('rejects an empty title', () => {
      const result = createTaskSchema.safeParse({
        title: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an invalid priority', () => {
      const result = createTaskSchema.safeParse({
        title: 'Valid title',
        priority: 'critical_emergency',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-UUID assignee IDs', () => {
      const result = createTaskSchema.safeParse({
        title: 'Valid title',
        assigneeIds: ['not-a-valid-uuid'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-UUID projectId', () => {
      const result = createTaskSchema.safeParse({
        title: 'Valid title',
        projectId: '12345',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateTaskSchema', () => {
    it('accepts partial updates', () => {
      const result = updateTaskSchema.safeParse({
        title: 'Updated title',
        priority: 'high',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Updated title');
        expect(result.data.priority).toBe('high');
      }
    });

    it('allows nulling nullable fields', () => {
      const result = updateTaskSchema.safeParse({
        description: null,
        projectId: null,
        dueDate: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBeNull();
        expect(result.data.projectId).toBeNull();
        expect(result.data.dueDate).toBeNull();
      }
    });
  });

  describe('transitionTaskSchema', () => {
    it('accepts valid statuses and optional notes', () => {
      for (const status of ['pending', 'in_progress', 'completed', 'cancelled'] as const) {
        const result = transitionTaskSchema.safeParse({
          status,
          notes: `Transitioning to ${status}`,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects an invalid status', () => {
      const result = transitionTaskSchema.safeParse({
        status: 'archived',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('assignTaskSchema', () => {
    it('accepts valid assignee UUID arrays', () => {
      const result = assignTaskSchema.safeParse({
        assigneeIds: [
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-UUID strings', () => {
      const result = assignTaskSchema.safeParse({
        assigneeIds: ['bad-id'],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('taskListQuerySchema', () => {
    it('applies default pagination and sorting values', () => {
      const result = taskListQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('all');
        expect(result.data.priority).toBe('all');
        expect(result.data.datePreset).toBe('all');
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(20);
        expect(result.data.sortBy).toBe('dueDate');
        expect(result.data.sortOrder).toBe('asc');
      }
    });

    it('coerces string numbers for page and pageSize', () => {
      const result = taskListQuerySchema.safeParse({
        page: '3',
        pageSize: '50',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.pageSize).toBe(50);
      }
    });

    it('rejects invalid page or pageSize > 100', () => {
      expect(taskListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
      expect(taskListQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
      expect(taskListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    });

    it('accepts custom datePreset with valid date range', () => {
      const result = taskListQuerySchema.safeParse({
        datePreset: 'custom',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects custom datePreset when startDate > endDate', () => {
      const result = taskListQuerySchema.safeParse({
        datePreset: 'custom',
        startDate: '2026-02-01T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });

    it('rejects custom datePreset when dates are missing', () => {
      const result = taskListQuerySchema.safeParse({
        datePreset: 'custom',
      });
      expect(result.success).toBe(false);
    });
  });
});
