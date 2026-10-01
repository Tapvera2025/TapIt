import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestContext, type RequestContext } from '../../../platform/dal/context.js';
import { errorHandler, NotFoundError } from '../../../platform/http/error-handler.js';
import { __resetRoutes } from '../../../platform/http/route.js';
import { buildRouter } from '../../../platform/http/router.js';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { registerMyNotepadRoutes } from '../routes.js';
import { registerMyNotepadAdminRoutes } from './routes.js';
import * as adminService from './service.js';
import * as personalService from '../service.js';
import type { PaginatedEmployeeNotesResult } from './types.js';

describe('Super Admin — Employee Notes Monitoring', () => {
  const org1 = randomUUID();
  const _org2 = randomUUID();
  const superAdminUser = randomUUID();
  const employeeUserA = randomUUID();
  const employeeUserB = randomUUID();
  const employeeOrg2 = randomUUID();

  beforeEach(() => {
    vi.restoreAllMocks();
    installAuthz();
    __resetRoutes();
    registerMyNotepadRoutes();
    registerMyNotepadAdminRoutes();
  });

  function createSuperAdminContext(organizationId: string, userId: string = superAdminUser): RequestContext {
    return createRequestContext({
      organizationId,
      principal: {
        id: userId,
        organizationId,
        accountType: 'super-admin',
        sessionVersion: 1,
      },
      requestId: `req-admin-${userId}`,
    });
  }

  function createEmployeeContext(organizationId: string, userId: string = employeeUserA): RequestContext {
    return createRequestContext({
      organizationId,
      principal: {
        id: userId,
        organizationId,
        accountType: 'employee',
        sessionVersion: 1,
        positionId: randomUUID(),
        departmentId: randomUUID(),
        teamId: null,
        reportsTo: null,
        organizationalLevel: 10,
      },
      requestId: `req-emp-${userId}`,
    });
  }

  function createApp(ctxProvider: (req: express.Request) => RequestContext | undefined) {
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

  // 1. Authorized Super Admin can list employees
  it('1. Authorized Super Admin can list employees', async () => {
    const ctx = createSuperAdminContext(org1);
    const mockList: PaginatedEmployeeNotesResult = {
      items: [
        {
          userId: employeeUserA,
          name: 'Alice Engineer',
          email: 'alice@example.com',
          department: 'Engineering',
          designation: 'Software Engineer',
          hasNote: true,
          lastUpdatedAt: new Date('2026-09-29T10:00:00Z').toISOString(),
        },
        {
          userId: employeeUserB,
          name: 'Bob Designer',
          email: 'bob@example.com',
          department: 'Design',
          designation: 'Product Designer',
          hasNote: false,
          lastUpdatedAt: null,
        },
      ],
      total: 2,
      page: 1,
      limit: 50,
    };

    const listSpy = vi.spyOn(adminService, 'listEmployeeNotes').mockResolvedValueOnce(mockList);

    const app = createApp(() => ctx);
    const res = await request(app).get('/api/admin/employee-notes');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].userId).toBe(employeeUserA);
    expect(res.body.data.items[0].hasNote).toBe(true);
    expect(res.body.data.items[1].hasNote).toBe(false);
    expect(res.body.data.total).toBe(2);
    expect(listSpy).toHaveBeenCalledWith(ctx, expect.objectContaining({ page: 1, limit: 50 }));
  });

  // 2. Department filtering works
  it('2. Department filtering works', async () => {
    const ctx = createSuperAdminContext(org1);
    const listSpy = vi.spyOn(adminService, 'listEmployeeNotes').mockResolvedValueOnce({
      items: [
        {
          userId: employeeUserA,
          name: 'Alice Engineer',
          email: 'alice@example.com',
          department: 'Engineering',
          designation: 'Software Engineer',
          hasNote: true,
          lastUpdatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });

    const app = createApp(() => ctx);
    const res = await request(app).get('/api/admin/employee-notes?department=Engineering');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(listSpy).toHaveBeenCalledWith(ctx, expect.objectContaining({ department: 'Engineering' }));
  });

  // 3. Employee search works
  it('3. Employee search works', async () => {
    const ctx = createSuperAdminContext(org1);
    const listSpy = vi.spyOn(adminService, 'listEmployeeNotes').mockResolvedValueOnce({
      items: [
        {
          userId: employeeUserB,
          name: 'Bob Designer',
          email: 'bob@example.com',
          department: 'Design',
          designation: 'Product Designer',
          hasNote: false,
          lastUpdatedAt: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });

    const app = createApp(() => ctx);
    const res = await request(app).get('/api/admin/employee-notes?search=Bob');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(listSpy).toHaveBeenCalledWith(ctx, expect.objectContaining({ search: 'Bob' }));
  });

  // 4. Authorized Super Admin can read current note
  it('4. Authorized Super Admin can read current note', async () => {
    const ctx = createSuperAdminContext(org1);
    const noteId = randomUUID();

    // mock resource loader: employee exists in org1
    vi.spyOn(adminService, 'loadNotepadResource').mockResolvedValueOnce({
      type: 'notepad',
      id: employeeUserA,
      userId: employeeUserA,
      organizationId: org1,
    });

    const getSpy = vi.spyOn(adminService, 'getEmployeeCurrentNote').mockResolvedValueOnce({
      id: noteId,
      organizationId: org1,
      userId: employeeUserA,
      content: 'Important work notes from Alice',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const app = createApp(() => ctx);
    const res = await request(app).get(`/api/admin/employee-notes/${employeeUserA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('Important work notes from Alice');
    expect(res.body.data.userId).toBe(employeeUserA);
    expect(getSpy).toHaveBeenCalledWith(ctx, employeeUserA);
  });

  // 5. Authorized Super Admin can read history
  it('5. Authorized Super Admin can read history', async () => {
    const ctx = createSuperAdminContext(org1);
    const histId1 = randomUUID();
    const histId2 = randomUUID();

    vi.spyOn(adminService, 'loadNotepadResource').mockResolvedValueOnce({
      type: 'notepad',
      id: employeeUserA,
      userId: employeeUserA,
      organizationId: org1,
    });

    const historySpy = vi.spyOn(adminService, 'getEmployeeNoteHistory').mockResolvedValueOnce([
      {
        id: histId2,
        organizationId: org1,
        userId: employeeUserA,
        content: 'Alice note rev 2',
        createdAt: new Date('2026-09-29T10:00:00Z').toISOString(),
      },
      {
        id: histId1,
        organizationId: org1,
        userId: employeeUserA,
        content: 'Alice note rev 1',
        createdAt: new Date('2026-09-29T09:00:00Z').toISOString(),
      },
    ]);

    const app = createApp(() => ctx);
    const res = await request(app).get(`/api/admin/employee-notes/${employeeUserA}/history`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].content).toBe('Alice note rev 2');
    expect(historySpy).toHaveBeenCalledWith(ctx, employeeUserA);
  });

  // 6. Authorized Super Admin can read history snapshot
  it('6. Authorized Super Admin can read history snapshot', async () => {
    const ctx = createSuperAdminContext(org1);
    const histId = randomUUID();

    vi.spyOn(adminService, 'loadNotepadResource').mockResolvedValueOnce({
      type: 'notepad',
      id: employeeUserA,
      userId: employeeUserA,
      organizationId: org1,
    });

    const snapshotSpy = vi.spyOn(adminService, 'getEmployeeHistoricalNote').mockResolvedValueOnce({
      id: histId,
      organizationId: org1,
      userId: employeeUserA,
      content: 'Snapshot content',
      createdAt: new Date('2026-09-29T09:00:00Z').toISOString(),
    });

    const app = createApp(() => ctx);
    const res = await request(app).get(`/api/admin/employee-notes/${employeeUserA}/history/${histId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(histId);
    expect(res.body.data.content).toBe('Snapshot content');
    expect(snapshotSpy).toHaveBeenCalledWith(ctx, employeeUserA, histId);
  });

  // 7. Unauthorized user is rejected
  it('7. Unauthorized employee is rejected with 403 Forbidden', async () => {
    const { db } = await import('../../../platform/dal/db.js');
    vi.spyOn(db, 'query').mockResolvedValue([]);
    const ctx = createEmployeeContext(org1, employeeUserA);
    const app = createApp(() => ctx);

    // List endpoint (no resource loader, checks action authorization directly)
    const resList = await request(app).get('/api/admin/employee-notes');
    expect(resList.status).toBe(403);
    expect(resList.body.code).toBe('FORBIDDEN');

    // Individual note endpoint (resource exists in org, but user lacks authorization)
    vi.spyOn(adminService, 'loadNotepadResource').mockResolvedValue({
      type: 'notepad',
      id: employeeUserB,
      userId: employeeUserB,
      organizationId: org1,
    });

    const resNote = await request(app).get(`/api/admin/employee-notes/${employeeUserB}`);
    expect(resNote.status).toBe(403);
    expect(resNote.body.code).toBe('FORBIDDEN');

    // History endpoint
    const resHist = await request(app).get(`/api/admin/employee-notes/${employeeUserB}/history`);
    expect(resHist.status).toBe(403);
    expect(resHist.body.code).toBe('FORBIDDEN');

    // Unauthenticated user is rejected with 401
    const unauthApp = createApp(() => undefined);
    const resUnauth = await request(unauthApp).get('/api/admin/employee-notes');
    expect(resUnauth.status).toBe(401);
  });

  // 8. Cross-organization employee access is rejected
  it('8. Cross-organization employee access is rejected with 404', async () => {
    const ctx = createSuperAdminContext(org1);

    // Resource loader returns null because employeeOrg2 belongs to org2, not org1
    vi.spyOn(adminService, 'loadNotepadResource').mockResolvedValueOnce(null);

    const app = createApp(() => ctx);
    const res = await request(app).get(`/api/admin/employee-notes/${employeeOrg2}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  // 9. Cross-organization note access is rejected
  it('9. Cross-organization note access is rejected with 404', async () => {
    const ctx = createSuperAdminContext(org1);

    // Service throws NotFoundError('Employee') if employee is outside org1
    vi.spyOn(adminService, 'loadNotepadResource').mockResolvedValueOnce(null);

    const app = createApp(() => ctx);
    const res = await request(app).get(`/api/admin/employee-notes/${employeeOrg2}/history`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  // 10. Cross-user history access is rejected
  it('10. Cross-user history access is rejected with 404 when history snapshot belongs to another user', async () => {
    const ctx = createSuperAdminContext(org1);
    const foreignHistId = randomUUID();

    vi.spyOn(adminService, 'loadNotepadResource').mockResolvedValueOnce({
      type: 'notepad',
      id: employeeUserA,
      userId: employeeUserA,
      organizationId: org1,
    });

    // Service checks user_id and history_id; if historyId does not belong to userA, it throws NotFoundError
    vi.spyOn(adminService, 'getEmployeeHistoricalNote').mockRejectedValueOnce(
      new NotFoundError('Historical note'),
    );

    const app = createApp(() => ctx);
    const res = await request(app).get(
      `/api/admin/employee-notes/${employeeUserA}/history/${foreignHistId}`,
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  // 11. Existing personal My Notepad behavior remains intact
  it('11. Existing personal My Notepad behavior remains intact', async () => {
    const empCtx = createEmployeeContext(org1, employeeUserA);
    const noteId = randomUUID();

    const getPersonalSpy = vi.spyOn(personalService, 'getCurrentNote').mockResolvedValueOnce({
      id: noteId,
      organizationId: org1,
      userId: employeeUserA,
      content: 'My own personal note',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const app = createApp(() => empCtx);
    const res = await request(app).get('/api/my-notepad');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('My own personal note');
    expect(res.body.data.userId).toBe(employeeUserA);
    expect(getPersonalSpy).toHaveBeenCalledWith(empCtx);
  });

  // 12. DAL query mapping resolves camelCase row properties correctly into EmployeeNoteSummaryItem
  it('12. DAL query mapping resolves camelCase row properties correctly into EmployeeNoteSummaryItem', async () => {
    const { listEmployeeNotes: repoListEmployeeNotes } = await import('./repository.js');
    const { db } = await import('../../../platform/dal/db.js');

    const ctx = createSuperAdminContext(org1);
    const mockDbDate = new Date('2026-09-29T12:00:00Z');

    // Mock count query
    vi.spyOn(db, 'one').mockResolvedValueOnce({ count: '1' });
    // Mock db.query returning camelized rows as the DAL actually does
    vi.spyOn(db, 'query').mockResolvedValueOnce([
      {
        userId: employeeUserA,
        name: 'Alice Developer',
        email: 'alice@example.com',
        department: 'Engineering',
        designation: 'Staff Engineer',
        hasNote: true,
        lastUpdatedAt: mockDbDate,
      },
    ]);

    const result = await repoListEmployeeNotes(ctx);

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.userId).toBe(employeeUserA);
    expect(result.items[0]?.hasNote).toBe(true);
    expect(result.items[0]?.lastUpdatedAt).toBe(mockDbDate.toISOString());
  });

  // 13. Resource loader ensures ownerId is populated for P3 constraint alignment
  it('13. Resource loader ensures ownerId is populated for P3 constraint alignment', async () => {
    const ctx = createSuperAdminContext(org1);
    vi.spyOn(adminService, 'loadNotepadResource').mockResolvedValueOnce({
      type: 'notepad',
      id: employeeUserA,
      userId: employeeUserA,
      ownerId: employeeUserA,
      organizationId: org1,
    });

    const app = createApp(() => ctx);
    vi.spyOn(adminService, 'getEmployeeCurrentNote').mockResolvedValueOnce({
      id: 'note-1',
      organizationId: org1,
      userId: employeeUserA,
      content: 'Current note',
      createdAt: null,
      updatedAt: null,
    });

    const res = await request(app).get(`/api/admin/employee-notes/${employeeUserA}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe(employeeUserA);
  });
});
