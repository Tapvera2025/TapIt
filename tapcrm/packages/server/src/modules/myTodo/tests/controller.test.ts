import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestContext,
  type RequestContext,
} from '../../../platform/dal/context.js';
import {
  completeTodoController,
  createTodoController,
  deleteTodoController,
  getTodoByIdController,
  listTodosController,
  reopenTodoController,
  updateTodoController,
} from '../controller.js';
import * as service from '../service.js';
import type { MyTodo } from '../types.js';

describe('My Todo controllers', () => {
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

  function mockRequestResponse(
    overrides: Partial<Request> = {},
  ): { req: Request; res: Response; next: ReturnType<typeof vi.fn> } {
    const req = {
      ctx: createTestContext(),
      body: {},
      params: {},
      query: {},
      ...overrides,
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const next = vi.fn();

    return { req, res, next };
  }

  const sampleTodo: MyTodo = {
    id: randomUUID(),
    organizationId: orgId,
    userId: userId,
    title: 'Test Todo',
    description: null,
    priority: 'medium',
    scheduledDate: '2026-09-30',
    dueTime: '12:00',
    status: 'pending',
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe('createTodoController', () => {
    it('creates todo and responds with status 201', async () => {
      const { req, res, next } = mockRequestResponse({
        body: { title: 'New Todo' },
      });
      vi.spyOn(service, 'createTodo').mockResolvedValueOnce(sampleTodo);

      await createTodoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: sampleTodo }));
      expect(next).not.toHaveBeenCalled();
    });

    it('passes error to next when context is missing', async () => {
      const { req, res, next } = mockRequestResponse();
      delete (req as unknown as { ctx?: RequestContext }).ctx;

      await createTodoController(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('passes validation error to next on invalid body', async () => {
      const { req, res, next } = mockRequestResponse({
        body: { title: '' },
      });

      await createTodoController(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('listTodosController', () => {
    it('returns 200 with list of todos', async () => {
      const { req, res, next } = mockRequestResponse({
        query: { status: 'pending' },
      });
      vi.spyOn(service, 'listTodos').mockResolvedValueOnce([sampleTodo]);

      await listTodosController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: [sampleTodo] }));
    });
  });

  describe('getTodoByIdController', () => {
    it('returns 200 with requested todo', async () => {
      const { req, res, next } = mockRequestResponse({
        params: { id: sampleTodo.id },
      });
      vi.spyOn(service, 'getTodoById').mockResolvedValueOnce(sampleTodo);

      await getTodoByIdController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: sampleTodo }));
    });

    it('passes validation error to next on invalid param id', async () => {
      const { req, res, next } = mockRequestResponse({
        params: { id: 'not-a-uuid' },
      });

      await getTodoByIdController(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateTodoController', () => {
    it('returns 200 with updated todo', async () => {
      const { req, res, next } = mockRequestResponse({
        params: { id: sampleTodo.id },
        body: { title: 'Updated' },
      });
      vi.spyOn(service, 'updateTodo').mockResolvedValueOnce({ ...sampleTodo, title: 'Updated' });

      await updateTodoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('deleteTodoController', () => {
    it('returns 200 when deleted', async () => {
      const { req, res, next } = mockRequestResponse({
        params: { id: sampleTodo.id },
      });
      vi.spyOn(service, 'deleteTodo').mockResolvedValueOnce({ success: true });

      await deleteTodoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('completeTodoController & reopenTodoController', () => {
    it('completes todo', async () => {
      const { req, res, next } = mockRequestResponse({
        params: { id: sampleTodo.id },
      });
      vi.spyOn(service, 'completeTodo').mockResolvedValueOnce({ ...sampleTodo, status: 'completed' });

      await completeTodoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('reopens todo', async () => {
      const { req, res, next } = mockRequestResponse({
        params: { id: sampleTodo.id },
      });
      vi.spyOn(service, 'reopenTodo').mockResolvedValueOnce({ ...sampleTodo, status: 'pending' });

      await reopenTodoController(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
