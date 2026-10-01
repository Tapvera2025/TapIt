import { describe, expect, it } from 'vitest';
import {
  createTodoSchema,
  listTodosQuerySchema,
  MAX_TODO_DESCRIPTION_LENGTH,
  MAX_TODO_TITLE_LENGTH,
  todoIdParamSchema,
  updateTodoSchema,
} from './validators.js';

describe('My Todo Validators', () => {
  describe('createTodoSchema', () => {
    it('accepts valid minimal input with default priority', () => {
      const parsed = createTodoSchema.parse({
        title: 'Review proposal',
      });
      expect(parsed).toEqual({
        title: 'Review proposal',
        priority: 'medium',
      });
    });

    it('accepts valid full input', () => {
      const input = {
        title: 'Complete project report',
        description: 'Finish documentation',
        priority: 'high' as const,
        scheduledDate: '2026-09-30',
        dueTime: '18:00',
      };
      const parsed = createTodoSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it('rejects empty title or whitespace-only title', () => {
      expect(() => createTodoSchema.parse({ title: '' })).toThrow();
      expect(() => createTodoSchema.parse({ title: '   ' })).toThrow();
    });

    it('rejects missing title', () => {
      expect(() => createTodoSchema.parse({})).toThrow('Title is required');
    });

    it('rejects title exceeding max length', () => {
      const longTitle = 'a'.repeat(MAX_TODO_TITLE_LENGTH + 1);
      expect(() => createTodoSchema.parse({ title: longTitle })).toThrow();
    });

    it('rejects description exceeding max length', () => {
      const longDesc = 'a'.repeat(MAX_TODO_DESCRIPTION_LENGTH + 1);
      expect(() =>
        createTodoSchema.parse({
          title: 'Valid title',
          description: longDesc,
        }),
      ).toThrow();
    });

    it('rejects invalid priority', () => {
      expect(() =>
        createTodoSchema.parse({
          title: 'Task',
          priority: 'urgent' as never,
        }),
      ).toThrow();
    });

    it('rejects invalid scheduled date format', () => {
      expect(() =>
        createTodoSchema.parse({
          title: 'Task',
          scheduledDate: '30-09-2026',
        }),
      ).toThrow('Scheduled date must be in YYYY-MM-DD format');
    });

    it('rejects invalid due time format', () => {
      expect(() =>
        createTodoSchema.parse({
          title: 'Task',
          dueTime: '25:99',
        }),
      ).toThrow('Due time must be in HH:mm or HH:mm:ss format');
    });

    it('rejects spoofed userId or organizationId due to strict mode', () => {
      expect(() =>
        createTodoSchema.parse({
          title: 'Task',
          userId: '11111111-1111-4111-8111-111111111111',
        }),
      ).toThrow();

      expect(() =>
        createTodoSchema.parse({
          title: 'Task',
          organizationId: '22222222-2222-4222-8222-222222222222',
        }),
      ).toThrow();
    });
  });

  describe('updateTodoSchema', () => {
    it('accepts partial updates', () => {
      const parsed = updateTodoSchema.parse({
        title: 'Updated title',
        status: 'completed',
      });
      expect(parsed).toEqual({
        title: 'Updated title',
        status: 'completed',
      });
    });

    it('rejects invalid status', () => {
      expect(() =>
        updateTodoSchema.parse({
          status: 'in_progress' as never,
        }),
      ).toThrow();
    });

    it('rejects spoofed fields', () => {
      expect(() =>
        updateTodoSchema.parse({
          userId: '11111111-1111-4111-8111-111111111111',
        }),
      ).toThrow();
    });
  });

  describe('todoIdParamSchema', () => {
    it('accepts valid UUID', () => {
      const id = '12345678-1234-4234-8234-123456789012';
      expect(todoIdParamSchema.parse({ id })).toEqual({ id });
    });

    it('rejects non-UUID', () => {
      expect(() => todoIdParamSchema.parse({ id: 'abc-123' })).toThrow(
        'Invalid Todo ID',
      );
    });
  });

  describe('listTodosQuerySchema', () => {
    it('accepts valid filters', () => {
      const parsed = listTodosQuerySchema.parse({
        status: 'pending',
        scheduledDate: '2026-09-30',
      });
      expect(parsed).toEqual({
        status: 'pending',
        scheduledDate: '2026-09-30',
      });
    });

    it('rejects invalid status in query', () => {
      expect(() =>
        listTodosQuerySchema.parse({ status: 'invalid' as never }),
      ).toThrow();
    });
  });
});
