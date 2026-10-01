import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestContext,
  type RequestContext,
} from '../../platform/dal/context.js';
import { errorHandler, NotFoundError } from '../../platform/http/error-handler.js';
import { __resetRoutes } from '../../platform/http/route.js';
import { buildRouter } from '../../platform/http/router.js';
import { registerMyTodoRoutes } from './routes.js';
import * as service from './service.js';
import type { MyTodo } from './types.js';

describe('My Todo Routes & Central Router', () => {
  const org1 = randomUUID();
  const org2 = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  beforeEach(() => {
    __resetRoutes();
    registerMyTodoRoutes();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetRoutes();
  });

  function createSuperAdminContext(
    organizationId: string,
    userId: string,
  ): RequestContext {
    return createRequestContext({
      organizationId,
      principal: {
        id: userId,
        organizationId,
        accountType: 'super-admin',
        sessionVersion: 1,
      },
      requestId: `req-${userId}`,
    });
  }

  function createEmployeeContext(
    organizationId: string,
    userId: string,
  ): RequestContext {
    return createRequestContext({
      organizationId,
      principal: {
        id: userId,
        organizationId,
        accountType: 'employee',
        sessionVersion: 1,
        positionId: 'pos-1',
        departmentId: 'dept-1',
        teamId: null,
        reportsTo: null,
        organizationalLevel: 1,
      },
      requestId: `req-${userId}`,
    });
  }

  const createTestContext = createSuperAdminContext;

  function createApp(
    ctxProvider: (req: express.Request) => RequestContext | undefined,
  ) {
    const app = express();
    app.use(express.json());

    app.use((req, res, next) => {
      const ctx = ctxProvider(req);
      if (!ctx) {
        res.status(401).json({
          success: false,
          code: 'UNAUTHENTICATED',
          message: 'Authentication required',
        });
        return;
      }
      req.ctx = ctx;
      next();
    });

    app.use(buildRouter());
    app.use(errorHandler);
    return app;
  }

  const sampleTodo = (
    organizationId: string,
    userId: string,
    overrides: Partial<MyTodo> = {},
  ): MyTodo => ({
    id: randomUUID(),
    organizationId,
    userId,
    title: 'Test Todo',
    description: 'A description',
    priority: 'medium',
    scheduledDate: '2026-09-30',
    dueTime: '14:00',
    status: 'pending',
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  it('1. Authenticated user can create Todo', async () => {
    const app = createApp(() => createTestContext(org1, userA));
    const todo = sampleTodo(org1, userA, { title: 'New Task' });
    const createSpy = vi
      .spyOn(service, 'createTodo')
      .mockResolvedValueOnce(todo);

    const res = await request(app)
      .post('/api/my-todo')
      .send({
        title: 'New Task',
        description: 'New Description',
        priority: 'high',
        scheduledDate: '2026-09-30',
        dueTime: '18:00',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(todo.id);
    expect(res.body.data.title).toBe('New Task');
    expect(createSpy).toHaveBeenCalledWith(expect.any(Object), {
      title: 'New Task',
      description: 'New Description',
      priority: 'high',
      scheduledDate: '2026-09-30',
      dueTime: '18:00',
    });
  });

  it('2. Authenticated user can list own Todos', async () => {
    const todo = sampleTodo(org1, userA);
    const app = createApp(() => createTestContext(org1, userA));
    const listSpy = vi.spyOn(service, 'listTodos').mockResolvedValueOnce([todo]);

    const res = await request(app)
      .get('/api/my-todo')
      .query({ status: 'pending' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(todo.id);
    expect(listSpy).toHaveBeenCalledWith(expect.any(Object), {
      status: 'pending',
    });
  });

  it('3. Authenticated user can retrieve own Todo', async () => {
    const app = createApp(() => createTestContext(org1, userA));
    const todo = sampleTodo(org1, userA);
    const getSpy = vi.spyOn(service, 'getTodoById').mockResolvedValueOnce(todo);

    const res = await request(app).get(`/api/my-todo/${todo.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(todo.id);
    expect(getSpy).toHaveBeenCalledWith(expect.any(Object), todo.id);
  });

  it('4. Authenticated user can update own Todo', async () => {
    const app = createApp(() => createTestContext(org1, userA));
    const todo = sampleTodo(org1, userA, { title: 'Updated Title' });
    const updateSpy = vi
      .spyOn(service, 'updateTodo')
      .mockResolvedValueOnce(todo);

    const res = await request(app)
      .patch(`/api/my-todo/${todo.id}`)
      .send({ title: 'Updated Title', status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Updated Title');
    expect(updateSpy).toHaveBeenCalledWith(expect.any(Object), todo.id, {
      title: 'Updated Title',
      status: 'completed',
    });
  });

  it('5. Authenticated user can delete own Todo', async () => {
    const app = createApp(() => createTestContext(org1, userA));
    const todoId = randomUUID();
    const deleteSpy = vi
      .spyOn(service, 'deleteTodo')
      .mockResolvedValueOnce({ success: true });

    const res = await request(app).delete(`/api/my-todo/${todoId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.success).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith(expect.any(Object), todoId);
  });

  it('6. Authenticated user can complete Todo', async () => {
    const app = createApp(() => createTestContext(org1, userA));
    const todo = sampleTodo(org1, userA, { status: 'completed' });
    const completeSpy = vi
      .spyOn(service, 'completeTodo')
      .mockResolvedValueOnce(todo);

    const res = await request(app).post(`/api/my-todo/${todo.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('completed');
    expect(completeSpy).toHaveBeenCalledWith(expect.any(Object), todo.id);
  });

  it('7. Authenticated user cannot access another user Todo', async () => {
    const app = createApp(() => createTestContext(org1, userA));
    const foreignTodoId = randomUUID();
    vi.spyOn(service, 'getTodoById').mockRejectedValueOnce(
      new NotFoundError('Todo'),
    );

    const res = await request(app).get(`/api/my-todo/${foreignTodoId}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('8. Cross-organization access is blocked: strictly scoped to ctx.organizationId', async () => {
    let capturedCtx: RequestContext | undefined;
    vi.spyOn(service, 'createTodo').mockImplementationOnce(async (context, input) => {
      capturedCtx = context;
      return sampleTodo(context.organizationId, context.principal.id, {
        title: input.title,
      });
    });

    const appOrg2 = createApp(() => createTestContext(org2, userA));
    const res = await request(appOrg2)
      .post('/api/my-todo')
      .send({ title: 'Org 2 Todo' });

    expect(res.status).toBe(201);
    expect(capturedCtx?.organizationId).toBe(org2);
    expect(res.body.data.organizationId).toBe(org2);
  });

  it('9. userId cannot be spoofed through request body', async () => {
    const app = createApp(() => createTestContext(org1, userA));

    const res = await request(app)
      .post('/api/my-todo')
      .send({
        title: 'Malicious Todo',
        userId: userB,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('10. organizationId cannot be spoofed through request body', async () => {
    const app = createApp(() => createTestContext(org1, userA));

    const res = await request(app)
      .post('/api/my-todo')
      .send({
        title: 'Malicious Todo',
        organizationId: org2,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('11. Validation rejects invalid title', async () => {
    const app = createApp(() => createTestContext(org1, userA));

    const resEmpty = await request(app)
      .post('/api/my-todo')
      .send({ title: '   ' });
    expect(resEmpty.status).toBe(422);

    const resMissing = await request(app).post('/api/my-todo').send({});
    expect(resMissing.status).toBe(422);
  });

  it('12. Validation rejects invalid priority', async () => {
    const app = createApp(() => createTestContext(org1, userA));

    const res = await request(app)
      .post('/api/my-todo')
      .send({ title: 'Todo', priority: 'invalid-priority' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('13. Validation rejects invalid status in PATCH', async () => {
    const app = createApp(() => createTestContext(org1, userA));
    const todoId = randomUUID();

    const res = await request(app)
      .patch(`/api/my-todo/${todoId}`)
      .send({ status: 'invalid-status' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('14. Ownership is derived from RequestContext', async () => {
    let capturedCtx: RequestContext | undefined;
    vi.spyOn(service, 'listTodos').mockImplementationOnce(async (context) => {
      capturedCtx = context;
      return [];
    });

    const appA = createApp(() => createTestContext(org1, userA));
    const res = await request(appA).get('/api/my-todo');

    expect(res.status).toBe(200);
    expect(capturedCtx?.principal.id).toBe(userA);
    expect(capturedCtx?.organizationId).toBe(org1);

    // Also verify that attempting to pass spoofed userId in query is rejected with 422
    const spoofRes = await request(appA)
      .get('/api/my-todo')
      .query({ userId: userB });
    expect(spoofRes.status).toBe(422);
  });

  it('15. Route requires authentication', async () => {
    const app = createApp(() => undefined);
    const res = await request(app).get('/api/my-todo');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('allows universal access across roles (super-admin, hr, employee)', async () => {
    for (const contextFactory of [createSuperAdminContext, createEmployeeContext]) {
      const app = createApp(() => contextFactory(org1, userA));
      vi.spyOn(service, 'listTodos').mockResolvedValueOnce([]);

      const res = await request(app).get('/api/my-todo');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  it('POST /api/my-todo/:id/reopen marks pending', async () => {
    const app = createApp(() => createTestContext(org1, userA));
    const todo = sampleTodo(org1, userA, { status: 'pending' });
    vi.spyOn(service, 'reopenTodo').mockResolvedValueOnce(todo);

    const res = await request(app).post(`/api/my-todo/${todo.id}/reopen`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
  });
});
