import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestContext,
  type RequestContext,
} from '../../../platform/dal/context.js';
import { NotFoundError } from '../../../platform/http/error-handler.js';
import * as repository from '../repository.js';
import {
  completeTodo,
  createTodo,
  deleteTodo,
  getTodoById,
  listTodos,
  reopenTodo,
  toTodoView,
  updateTodo,
} from '../service.js';
import type { MyTodoDbRow } from '../types.js';

describe('My Todo service logic', () => {
  const orgId = randomUUID();
  const userId = randomUUID();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createTestContext(
    customOrgId = orgId,
    customUserId = userId,
  ): RequestContext {
    return createRequestContext({
      organizationId: customOrgId,
      principal: {
        id: customUserId,
        organizationId: customOrgId,
        accountType: 'super-admin',
        sessionVersion: 1,
      },
      requestId: 'test-req',
    });
  }

  function mockDbRow(overrides: Partial<MyTodoDbRow> = {}): MyTodoDbRow {
    const now = new Date();
    return {
      id: randomUUID(),
      organizationId: orgId,
      organization_id: orgId,
      userId: userId,
      user_id: userId,
      title: 'Review PR',
      description: 'Check changes',
      priority: 'medium',
      scheduledDate: '2026-09-30',
      scheduled_date: '2026-09-30',
      dueTime: '18:00',
      due_time: '18:00',
      status: 'pending',
      completedAt: null,
      completed_at: null,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now,
      ...overrides,
    };
  }

  describe('toTodoView', () => {
    it('formats scheduled_date when passed as Date object', () => {
      const dateObj = new Date('2026-09-30T00:00:00Z');
      const row = mockDbRow({ scheduled_date: dateObj as unknown as string });
      const view = toTodoView(row);
      expect(view.scheduledDate).toBe('2026-09-30');
    });

    it('returns null scheduled_date when missing', () => {
      const row = mockDbRow({ scheduled_date: null });
      const view = toTodoView(row);
      expect(view.scheduledDate).toBeNull();
    });

    it('handles camelCase database rows returned from DAL mapping', () => {
      const now = new Date('2026-09-30T10:00:00Z');
      const dalRow: MyTodoDbRow = {
        id: '123',
        organizationId: orgId,
        userId: userId,
        title: 'Task A',
        description: null,
        priority: 'high',
        scheduledDate: '2026-10-01',
        dueTime: '12:00',
        status: 'pending',
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const view = toTodoView(dalRow);
      expect(view.id).toBe('123');
      expect(view.organizationId).toBe(orgId);
      expect(view.userId).toBe(userId);
      expect(view.title).toBe('Task A');
      expect(view.scheduledDate).toBe('2026-10-01');
      expect(view.createdAt).toBe(now.toISOString());
    });
  });

  describe('createTodo', () => {
    it('creates and maps todo row to domain model', async () => {
      const ctx = createTestContext();
      const row = mockDbRow();
      vi.spyOn(repository, 'createTodoRow').mockResolvedValueOnce(row);

      const result = await createTodo(ctx, {
        title: row.title,
        description: row.description,
        priority: row.priority,
        scheduledDate: '2026-09-30',
        dueTime: '18:00',
      });

      expect(result).toEqual({
        id: row.id,
        organizationId: orgId,
        userId: userId,
        title: row.title,
        description: row.description,
        priority: row.priority,
        scheduledDate: '2026-09-30',
        dueTime: '18:00',
        status: 'pending',
        completedAt: null,
        createdAt: (row.createdAt as Date).toISOString(),
        updatedAt: (row.updatedAt as Date).toISOString(),
      });
    });
  });

  describe('listTodos', () => {
    it('returns empty array when user has no todos', async () => {
      const ctx = createTestContext();
      vi.spyOn(repository, 'listTodoRows').mockResolvedValueOnce([]);

      const result = await listTodos(ctx);
      expect(result).toEqual([]);
    });

    it('returns mapped array of user todos', async () => {
      const ctx = createTestContext();
      const row1 = mockDbRow({ title: 'Task 1' });
      const row2 = mockDbRow({ title: 'Task 2', status: 'completed', completed_at: new Date() });
      vi.spyOn(repository, 'listTodoRows').mockResolvedValueOnce([row1, row2]);

      const result = await listTodos(ctx);
      expect(result).toHaveLength(2);
      expect(result[0]!.title).toBe('Task 1');
      expect(result[1]!.title).toBe('Task 2');
      expect(result[1]!.status).toBe('completed');
      expect(result[1]!.completedAt).toBeDefined();
    });
  });

  describe('getTodoById', () => {
    it('returns mapped todo when found', async () => {
      const ctx = createTestContext();
      const row = mockDbRow();
      vi.spyOn(repository, 'findTodoRowById').mockResolvedValueOnce(row);

      const result = await getTodoById(ctx, row.id);
      expect(result.id).toBe(row.id);
      expect(result.title).toBe(row.title);
    });

    it('throws NotFoundError when not found or belongs to another user', async () => {
      const ctx = createTestContext();
      vi.spyOn(repository, 'findTodoRowById').mockResolvedValueOnce(null);

      await expect(getTodoById(ctx, randomUUID())).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateTodo', () => {
    it('returns updated mapped todo when found', async () => {
      const ctx = createTestContext();
      const row = mockDbRow({ title: 'Updated Title' });
      vi.spyOn(repository, 'updateTodoRow').mockResolvedValueOnce(row);

      const result = await updateTodo(ctx, row.id, { title: 'Updated Title' });
      expect(result.title).toBe('Updated Title');
    });

    it('throws NotFoundError when todo to update does not exist', async () => {
      const ctx = createTestContext();
      vi.spyOn(repository, 'updateTodoRow').mockResolvedValueOnce(null);

      await expect(
        updateTodo(ctx, randomUUID(), { title: 'New' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteTodo', () => {
    it('returns { success: true } when deleted', async () => {
      const ctx = createTestContext();
      vi.spyOn(repository, 'deleteTodoRow').mockResolvedValueOnce(true);

      const result = await deleteTodo(ctx, randomUUID());
      expect(result).toEqual({ success: true });
    });

    it('throws NotFoundError when todo to delete does not exist', async () => {
      const ctx = createTestContext();
      vi.spyOn(repository, 'deleteTodoRow').mockResolvedValueOnce(false);

      await expect(deleteTodo(ctx, randomUUID())).rejects.toThrow(NotFoundError);
    });
  });

  describe('completeTodo & reopenTodo', () => {
    it('completes todo', async () => {
      const ctx = createTestContext();
      const row = mockDbRow({ status: 'completed', completed_at: new Date() });
      vi.spyOn(repository, 'updateTodoRow').mockResolvedValueOnce(row);

      const result = await completeTodo(ctx, row.id);
      expect(result.status).toBe('completed');
    });

    it('reopens todo', async () => {
      const ctx = createTestContext();
      const row = mockDbRow({ status: 'pending', completed_at: null });
      vi.spyOn(repository, 'updateTodoRow').mockResolvedValueOnce(row);

      const result = await reopenTodo(ctx, row.id);
      expect(result.status).toBe('pending');
      expect(result.completedAt).toBeNull();
    });
  });
});
