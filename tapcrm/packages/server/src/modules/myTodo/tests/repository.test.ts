import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestContext,
  type RequestContext,
} from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import {
  createTodoRow,
  deleteTodoRow,
  findTodoRowById,
  listTodoRows,
  updateTodoRow,
} from '../repository.js';
import type { MyTodoDbRow } from '../types.js';

describe('My Todo repository queries', () => {
  const orgId = randomUUID();
  const userId = randomUUID();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createTestContext(): RequestContext {
    return createRequestContext({
      organizationId: orgId,
      principal: {
        id: userId,
        organizationId: orgId,
        accountType: 'super-admin',
        sessionVersion: 1,
      },
      requestId: 'test-req',
    });
  }

  describe('createTodoRow', () => {
    it('executes INSERT scoped strictly to organizationId and principal.id as active (deleted_at NULL)', async () => {
      const ctx = createTestContext();
      const mockResult: MyTodoDbRow = {
        id: randomUUID(),
        organization_id: orgId,
        user_id: userId,
        title: 'New Todo',
        description: null,
        priority: 'high',
        status: 'pending',
        deleted_at: null,
      };
      const oneSpy = vi.spyOn(db, 'one').mockResolvedValueOnce(mockResult);

      await createTodoRow(ctx, {
        title: 'New Todo',
        priority: 'high',
        scheduledDate: '2026-09-30',
        dueTime: '15:00',
      });

      expect(oneSpy).toHaveBeenCalledTimes(1);
      const [calledCtx, query] = oneSpy.mock.calls[0]!;
      expect(calledCtx.organizationId).toBe(orgId);
      expect(calledCtx.principal.id).toBe(userId);
      expect(query.sql).toContain('INSERT INTO my_todo');
      expect(query.sql).not.toContain('deleted_at');
      expect(query.parameters).toContain(orgId);
      expect(query.parameters).toContain(userId);
      expect(query.parameters).toContain('New Todo');
    });
  });

  describe('findTodoRowById', () => {
    it('returns null early for non-UUID id without querying database', async () => {
      const ctx = createTestContext();
      const maybeOneSpy = vi.spyOn(db, 'maybeOne');

      const result = await findTodoRowById(ctx, 'invalid-uuid');
      expect(result).toBeNull();
      expect(maybeOneSpy).not.toHaveBeenCalled();
    });

    it('queries with organizationId, userId, todo id, and enforces deleted_at IS NULL', async () => {
      const ctx = createTestContext();
      const todoId = randomUUID();
      const maybeOneSpy = vi.spyOn(db, 'maybeOne').mockResolvedValueOnce(null);

      await findTodoRowById(ctx, todoId);

      expect(maybeOneSpy).toHaveBeenCalledTimes(1);
      const [calledCtx, query] = maybeOneSpy.mock.calls[0]!;
      expect(calledCtx.organizationId).toBe(orgId);
      expect(calledCtx.principal.id).toBe(userId);
      expect(query.sql).toContain('WHERE organization_id = $1');
      expect(query.sql).toContain('user_id = $2');
      expect(query.sql).toContain('id = $3');
      expect(query.sql).toContain('deleted_at IS NULL');
      expect(query.parameters).toEqual([orgId, userId, todoId]);
    });

    it('does not return soft-deleted Todo (returns null)', async () => {
      const ctx = createTestContext();
      const todoId = randomUUID();
      vi.spyOn(db, 'maybeOne').mockResolvedValueOnce(null);

      const result = await findTodoRowById(ctx, todoId);
      expect(result).toBeNull();
    });
  });

  describe('listTodoRows', () => {
    it('queries strictly with user and org, enforcing deleted_at IS NULL to exclude soft-deleted todos', async () => {
      const ctx = createTestContext();
      const querySpy = vi.spyOn(db, 'query').mockResolvedValueOnce([]);

      await listTodoRows(ctx, { status: 'pending', scheduledDate: '2026-09-30' });

      expect(querySpy).toHaveBeenCalledTimes(1);
      const [calledCtx, query] = querySpy.mock.calls[0]!;
      expect(calledCtx.organizationId).toBe(orgId);
      expect(calledCtx.principal.id).toBe(userId);
      expect(query.sql).toContain('deleted_at IS NULL');
      expect(query.parameters).toContain(orgId);
      expect(query.parameters).toContain(userId);
      expect(query.parameters).toContain('pending');
      expect(query.parameters).toContain('2026-09-30');
    });
  });

  describe('updateTodoRow', () => {
    it('returns null early for non-UUID id', async () => {
      const ctx = createTestContext();
      const maybeOneSpy = vi.spyOn(db, 'maybeOne');

      const result = await updateTodoRow(ctx, 'not-uuid', { title: 'Test' });
      expect(result).toBeNull();
      expect(maybeOneSpy).not.toHaveBeenCalled();
    });

    it('updates status and sets completed_at when status is completed, scoped to active row only', async () => {
      const ctx = createTestContext();
      const todoId = randomUUID();
      const maybeOneSpy = vi.spyOn(db, 'maybeOne').mockResolvedValueOnce(null);

      await updateTodoRow(ctx, todoId, { status: 'completed' });

      expect(maybeOneSpy).toHaveBeenCalledTimes(1);
      const [calledCtx, query] = maybeOneSpy.mock.calls[0]!;
      expect(calledCtx.organizationId).toBe(orgId);
      expect(calledCtx.principal.id).toBe(userId);
      expect(query.sql).toContain('UPDATE my_todo');
      expect(query.sql).toContain('completed_at = now()');
      expect(query.sql).toContain('deleted_at IS NULL');
      expect(query.parameters).toContain(orgId);
      expect(query.parameters).toContain(userId);
      expect(query.parameters).toContain(todoId);
    });

    it('clears completed_at when status is pending and enforces deleted_at IS NULL', async () => {
      const ctx = createTestContext();
      const todoId = randomUUID();
      const maybeOneSpy = vi.spyOn(db, 'maybeOne').mockResolvedValueOnce(null);

      await updateTodoRow(ctx, todoId, { status: 'pending' });

      expect(maybeOneSpy).toHaveBeenCalledTimes(1);
      const [, query] = maybeOneSpy.mock.calls[0]!;
      expect(query.sql).toContain('completed_at = NULL');
      expect(query.sql).toContain('deleted_at IS NULL');
    });

    it('handles setting scheduledDate to null and enforces deleted_at IS NULL', async () => {
      const ctx = createTestContext();
      const todoId = randomUUID();
      const maybeOneSpy = vi.spyOn(db, 'maybeOne').mockResolvedValueOnce(null);

      await updateTodoRow(ctx, todoId, { scheduledDate: null });

      expect(maybeOneSpy).toHaveBeenCalledTimes(1);
      const [, query] = maybeOneSpy.mock.calls[0]!;
      expect(query.sql).toContain('scheduled_date = NULL');
      expect(query.sql).toContain('deleted_at IS NULL');
    });

    it('does not modify a soft-deleted Todo (returns null if deleted_at was not null)', async () => {
      const ctx = createTestContext();
      const todoId = randomUUID();
      vi.spyOn(db, 'maybeOne').mockResolvedValueOnce(null);

      const result = await updateTodoRow(ctx, todoId, { title: 'New Title' });
      expect(result).toBeNull();
    });
  });

  describe('deleteTodoRow', () => {
    it('returns false early for non-UUID id', async () => {
      const ctx = createTestContext();
      const maybeOneSpy = vi.spyOn(db, 'maybeOne');

      const result = await deleteTodoRow(ctx, 'bad-id');
      expect(result).toBe(false);
      expect(maybeOneSpy).not.toHaveBeenCalled();
    });

    it('performs soft delete via UPDATE rather than physical DELETE', async () => {
      const ctx = createTestContext();
      const todoId = randomUUID();
      const maybeOneSpy = vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: todoId });

      const result = await deleteTodoRow(ctx, todoId);
      expect(result).toBe(true);
      expect(maybeOneSpy).toHaveBeenCalledTimes(1);
      const [calledCtx, query] = maybeOneSpy.mock.calls[0]!;

      // Tenant and user isolation
      expect(calledCtx.organizationId).toBe(orgId);
      expect(calledCtx.principal.id).toBe(userId);

      // Must be an UPDATE, setting deleted_at and updated_at
      expect(query.sql).toContain('UPDATE my_todo');
      expect(query.sql).toContain('deleted_at = now()');
      expect(query.sql).toContain('updated_at = now()');

      // Must NOT physically remove the row
      expect(query.sql).not.toContain('DELETE FROM');

      // Scoped by organization_id, user_id, and id
      expect(query.parameters).toContain(orgId);
      expect(query.parameters).toContain(userId);
      expect(query.parameters).toContain(todoId);

      // Enforces deleted_at IS NULL so already soft-deleted rows are not modified
      expect(query.sql).toContain('deleted_at IS NULL');
      expect(query.sql).toContain('RETURNING id');
    });

    it('returns false if Todo is already soft-deleted or does not exist', async () => {
      const ctx = createTestContext();
      const todoId = randomUUID();
      vi.spyOn(db, 'maybeOne').mockResolvedValueOnce(null);

      const result = await deleteTodoRow(ctx, todoId);
      expect(result).toBe(false);
    });
  });
});
