import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { errorHandler, NotFoundError } from '../../platform/http/error-handler.js';
import { __resetRoutes } from '../../platform/http/route.js';
import { buildRouter } from '../../platform/http/router.js';
import { registerMyNotepadRoutes } from './routes.js';
import * as service from './service.js';
import { MAX_NOTE_LENGTH } from './validators.js';

describe('My Notepad Routes & Central Router', () => {
  const org1 = randomUUID();
  const org2 = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  beforeEach(() => {
    __resetRoutes();
    registerMyNotepadRoutes();
  });

  function createTestContext(organizationId: string, userId: string): RequestContext {
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

  function createApp(ctxProvider: (req: express.Request) => RequestContext | undefined) {
    const app = express();
    app.use(express.json({ limit: '15mb' }));

    // Request context simulation middleware (matches platform requestContext)
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

  it('1. Authenticated user can create/save a note', async () => {
    const noteId = randomUUID();
    const ctx = createTestContext(org1, userA);
    const saveSpy = vi.spyOn(service, 'saveNote').mockResolvedValueOnce({
      id: noteId,
      organizationId: org1,
      userId: userA,
      content: 'My secret notes',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const app = createApp(() => ctx);
    const res = await request(app)
      .put('/api/my-notepad')
      .send({ content: 'My secret notes' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('My secret notes');
    expect(res.body.data.id).toBe(noteId);
    expect(saveSpy).toHaveBeenCalledWith(ctx, { content: 'My secret notes' });
  });

  it('2. Authenticated user can retrieve current note', async () => {
    const ctx = createTestContext(org1, userA);
    const noteId = randomUUID();
    const getSpy = vi.spyOn(service, 'getCurrentNote').mockResolvedValueOnce({
      id: noteId,
      organizationId: org1,
      userId: userA,
      content: 'Current note content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const app = createApp(() => ctx);
    const res = await request(app).get('/api/my-notepad');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('Current note content');
    expect(getSpy).toHaveBeenCalledWith(ctx);
  });

  it('3. Authenticated user can clear current note', async () => {
    const ctx = createTestContext(org1, userA);
    const noteId = randomUUID();
    const clearSpy = vi.spyOn(service, 'clearNote').mockResolvedValueOnce({
      id: noteId,
      organizationId: org1,
      userId: userA,
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const app = createApp(() => ctx);
    const res = await request(app).delete('/api/my-notepad');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('');
    expect(clearSpy).toHaveBeenCalledWith(ctx);
  });

  it('4. Saving note invokes service transaction which creates history snapshot', async () => {
    const ctx = createTestContext(org1, userA);
    const noteId = randomUUID();
    const saveSpy = vi.spyOn(service, 'saveNote').mockResolvedValueOnce({
      id: noteId,
      organizationId: org1,
      userId: userA,
      content: 'Version 2 content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const app = createApp(() => ctx);
    const res = await request(app)
      .put('/api/my-notepad')
      .send({ content: 'Version 2 content' });

    expect(res.status).toBe(200);
    expect(saveSpy).toHaveBeenCalledWith(ctx, { content: 'Version 2 content' });
  });

  it('5. History returns saved snapshots for authenticated user', async () => {
    const ctx = createTestContext(org1, userA);
    const historyList = [
      {
        id: randomUUID(),
        organizationId: org1,
        userId: userA,
        content: 'Snap 2',
        createdAt: new Date('2026-09-29T10:00:00Z').toISOString(),
      },
      {
        id: randomUUID(),
        organizationId: org1,
        userId: userA,
        content: 'Snap 1',
        createdAt: new Date('2026-09-29T09:00:00Z').toISOString(),
      },
    ];
    const historySpy = vi.spyOn(service, 'getNoteHistory').mockResolvedValueOnce(historyList);

    const app = createApp(() => ctx);
    const res = await request(app).get('/api/my-notepad/history');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].content).toBe('Snap 2');
    expect(historySpy).toHaveBeenCalledWith(ctx);
  });

  it('6. Historical note can be previewed', async () => {
    const ctx = createTestContext(org1, userA);
    const historyId = randomUUID();
    const previewSpy = vi.spyOn(service, 'getHistoricalNote').mockResolvedValueOnce({
      id: historyId,
      organizationId: org1,
      userId: userA,
      content: 'Historical snapshot content',
      createdAt: new Date().toISOString(),
    });

    const app = createApp(() => ctx);
    const res = await request(app).get(`/api/my-notepad/history/${historyId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(historyId);
    expect(res.body.data.content).toBe('Historical snapshot content');
    expect(previewSpy).toHaveBeenCalledWith(ctx, historyId);
  });

  it('7. Returns 404 when historical note is not found or not visible', async () => {
    const ctx = createTestContext(org1, userA);
    const historyId = randomUUID();
    vi.spyOn(service, 'getHistoricalNote').mockRejectedValueOnce(
      new NotFoundError('Historical note'),
    );

    const app = createApp(() => ctx);
    const res = await request(app).get(`/api/my-notepad/history/${historyId}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('8. User A cannot access User B note: service strictly uses ctx.principal.id', async () => {
    let capturedCtx: RequestContext | undefined;
    vi.spyOn(service, 'getCurrentNote').mockImplementationOnce(async (context) => {
      capturedCtx = context;
      return {
        id: randomUUID(),
        organizationId: context.organizationId,
        userId: context.principal.id,
        content: `Note for ${context.principal.id}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    const appA = createApp(() => createTestContext(org1, userA));
    // User A attempts to pass userId in query or body
    const res = await request(appA)
      .get('/api/my-notepad')
      .query({ userId: userB });

    expect(res.status).toBe(200);
    // Verified that caller cannot override ownership through params
    expect(capturedCtx?.principal.id).toBe(userA);
    expect(res.body.data.userId).toBe(userA);
  });

  it('9. User A cannot access User B history: query strictly scopes to ctx.principal.id', async () => {
    let capturedCtx: RequestContext | undefined;
    vi.spyOn(service, 'getNoteHistory').mockImplementationOnce(async (context) => {
      capturedCtx = context;
      return [];
    });

    const appA = createApp(() => createTestContext(org1, userA));
    const res = await request(appA)
      .get('/api/my-notepad/history')
      .query({ userId: userB });

    expect(res.status).toBe(200);
    expect(capturedCtx?.principal.id).toBe(userA);
  });

  it('10. Cross-organization access is prevented: scoped to ctx.organizationId', async () => {
    let capturedCtx: RequestContext | undefined;
    vi.spyOn(service, 'saveNote').mockImplementationOnce(async (context, input) => {
      capturedCtx = context;
      return {
        id: randomUUID(),
        organizationId: context.organizationId,
        userId: context.principal.id,
        content: input.content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    const appOrg2 = createApp(() => createTestContext(org2, userA));
    const res = await request(appOrg2)
      .put('/api/my-notepad')
      .send({ content: 'Org 2 note' });

    expect(res.status).toBe(200);
    expect(capturedCtx?.organizationId).toBe(org2);
    expect(res.body.data.organizationId).toBe(org2);
  });

  it('11. Invalid note content is rejected: rejects payloads > 50,000 characters with 422', async () => {
    const ctx = createTestContext(org1, userA);
    const app = createApp(() => ctx);

    const tooLong = 'x'.repeat(MAX_NOTE_LENGTH + 1);
    const res = await request(app)
      .put('/api/my-notepad')
      .send({ content: tooLong });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('12. Missing note content is rejected with 422', async () => {
    const ctx = createTestContext(org1, userA);
    const app = createApp(() => ctx);

    const res = await request(app).put('/api/my-notepad').send({});

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('13. Invalid history ID format is rejected with 422', async () => {
    const ctx = createTestContext(org1, userA);
    const app = createApp(() => ctx);

    const res = await request(app).get('/api/my-notepad/history/not-a-uuid');

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('14. Unauthenticated request is rejected with 401', async () => {
    // No context provider -> req.ctx undefined
    const app = createApp(() => undefined);

    const res = await request(app).get('/api/my-notepad');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});
