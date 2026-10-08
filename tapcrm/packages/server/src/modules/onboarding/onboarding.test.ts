import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingWorkflowDto } from '@tapcrm/contracts';
import {
  createRequestContext,
  type RequestContext,
} from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { errorHandler } from '../../platform/http/error-handler.js';
import { __resetRoutes } from '../../platform/http/route.js';
import { buildRouter } from '../../platform/http/router.js';
import { installAuthz } from '../../platform/authz-adapter.js';
import { registerOnboardingRoutes } from './routes.js';
import * as service from './service.js';
import * as repo from './repository.js';
import { SEEDED_ONBOARDING_STEPS } from './types.js';

beforeAll(() => {
  process.env['DATABASE_URL'] = 'postgresql://tapcrm_app:test@localhost:5432/tapcrm_test';
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  process.env['JWT_ACCESS_SECRET'] = 'test-secret-at-least-32-chars-long-access';
  process.env['JWT_REFRESH_SECRET'] = 'test-secret-at-least-32-chars-long-refresh';
  process.env['CLIENT_ORIGIN'] = 'http://localhost:5173';
});

// Mock module entitlement check so route module guard passes in unit tests
vi.mock('../../platform/module-entitlement.js', () => ({
  requireModuleEnabled: vi.fn().mockResolvedValue(undefined),
  enabledModuleKeys: vi.fn().mockResolvedValue(['onboarding']),
}));

describe('Onboarding Routes & Workflow Creation (POST /api/onboarding)', () => {
  const org1 = randomUUID();
  const org2 = randomUUID();
  const adminId = randomUUID();
  const employeeId = randomUUID();
  const managerId = randomUUID();

  beforeEach(() => {
    vi.restoreAllMocks();
    installAuthz();
    __resetRoutes();
    registerOnboardingRoutes();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetRoutes();
  });

  function createSuperAdminContext(organizationId: string, userId: string = adminId): RequestContext {
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

  function createUnauthorizedEmployeeContext(
    organizationId: string,
    userId: string = randomUUID(),
  ): RequestContext {
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

  function sampleWorkflow(
    organizationId: string,
    targetEmployeeId: string,
    overrides: Partial<OnboardingWorkflowDto> = {},
  ): OnboardingWorkflowDto {
    const wfId = randomUUID();
    return {
      id: wfId,
      employeeId: targetEmployeeId,
      employeeName: 'Jane Doe',
      employeeEmail: 'jane.doe@example.com',
      departmentId: randomUUID(),
      departmentName: 'Engineering',
      status: 'in_progress',
      startedAt: '2026-10-01T09:00:00Z',
      completedAt: null,
      steps: [
        {
          id: randomUUID(),
          workflowId: wfId,
          code: 'ON-HR-1',
          title: 'Complete Personal Information & Emergency Contacts',
          description: 'Employee verifies and signs profile details',
          ownerId: adminId,
          ownerName: 'HR Admin',
          ownerRole: 'hr',
          status: 'pending',
          dueDate: '2026-10-08',
          completedAt: null,
          completedBy: null,
          completedByName: null,
          notes: null,
          stepOrder: 1,
        },
      ],
      progress: {
        total: 1,
        completed: 0,
        percent: 0,
      },
      ...overrides,
    };
  }

  // 1. POST /api/onboarding creates workflow
  it('1. POST /api/onboarding creates workflow and returns 201 with created workflow DTO', async () => {
    const app = createApp(() => createSuperAdminContext(org1));
    const expectedWf = sampleWorkflow(org1, employeeId);

    const createSpy = vi
      .spyOn(service, 'createWorkflow')
      .mockResolvedValueOnce(expectedWf);

    const res = await request(app)
      .post('/api/onboarding')
      .send({
        employeeId,
        startDate: '2026-10-01',
        managerId,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(expectedWf.id);
    expect(res.body.data.employeeId).toBe(employeeId);
    expect(res.body.data.status).toBe('in_progress');
    expect(res.body.data.steps).toHaveLength(1);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: org1 }),
      {
        employeeId,
        startDate: '2026-10-01',
        managerId,
      },
    );
  });

  // 2. Invalid payload rejected
  describe('2. Invalid payload rejected', () => {
    it('rejects missing employeeId with 422 validation error', async () => {
      const app = createApp(() => createSuperAdminContext(org1));

      const res = await request(app)
        .post('/api/onboarding')
        .send({
          startDate: '2026-10-01',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects invalid employeeId non-UUID with 422', async () => {
      const app = createApp(() => createSuperAdminContext(org1));

      const res = await request(app)
        .post('/api/onboarding')
        .send({
          employeeId: 'invalid-not-a-uuid',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects invalid startDate format with 422', async () => {
      const app = createApp(() => createSuperAdminContext(org1));

      const res = await request(app)
        .post('/api/onboarding')
        .send({
          employeeId,
          startDate: '01-10-2026', // wrong format
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects unrecognized extra fields (strict schema) with 422', async () => {
      const app = createApp(() => createSuperAdminContext(org1));

      const res = await request(app)
        .post('/api/onboarding')
        .send({
          employeeId,
          maliciousField: 'exploit',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  // 3. Unauthorized request rejected
  describe('3. Unauthorized request rejected', () => {
    it('rejects unauthenticated request with 401', async () => {
      const app = createApp(() => undefined); // no context

      const res = await request(app)
        .post('/api/onboarding')
        .send({ employeeId });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects employee lacking onboarding:manage permission with 403', async () => {
      vi.spyOn(db, 'query').mockResolvedValue([]);
      const app = createApp(() => createUnauthorizedEmployeeContext(org1));

      const res = await request(app)
        .post('/api/onboarding')
        .send({ employeeId });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // 4. Tenant isolation
  describe('4. Tenant isolation', () => {
    it('enforces tenant context in createWorkflow and rejects target employee from another organization', async () => {
      const ctxOrg1 = createSuperAdminContext(org1);

      // Mock database returning null when looking for employee in org1
      vi.spyOn(db, 'transaction').mockImplementation(async (ctx, fn) => {
        return fn({
          maybeOne: vi.fn().mockImplementation(async () => {
            // Emulate query checking organization_id: no row found because employee is in org2
            return null;
          }),
        } as unknown as Tx);
      });

      await expect(
        service.createWorkflow(ctxOrg1, { employeeId }),
      ).rejects.toThrow('Employee not found in this organization');
    });

    it('scopes workflow creation strictly to caller organizationId', async () => {
      const ctxOrg2 = createSuperAdminContext(org2);
      const app = createApp(() => ctxOrg2);

      let capturedContext: RequestContext | undefined;
      vi.spyOn(service, 'createWorkflow').mockImplementation(async (ctx, input) => {
        capturedContext = ctx;
        return sampleWorkflow(ctx.organizationId, input.employeeId);
      });

      const res = await request(app)
        .post('/api/onboarding')
        .send({ employeeId });

      expect(res.status).toBe(201);
      expect(capturedContext?.organizationId).toBe(org2);
      expect(capturedContext?.organizationId).not.toBe(org1);
    });
  });

  // 5. Existing GET/list endpoint still works
  describe('5. Existing GET/list endpoint still works', () => {
    it('GET /api/onboarding lists workflows', async () => {
      const app = createApp(() => createSuperAdminContext(org1));
      const mockList = [sampleWorkflow(org1, employeeId)];

      const listSpy = vi
        .spyOn(service, 'listAllWorkflows')
        .mockResolvedValueOnce(mockList);

      const res = await request(app)
        .get('/api/onboarding')
        .query({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(listSpy).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: org1 }),
        { status: 'in_progress', employeeId: undefined },
      );
    });

    it('GET /api/onboarding filters by employeeId', async () => {
      const app = createApp(() => createSuperAdminContext(org1));
      const mockList = [sampleWorkflow(org1, employeeId)];

      const listSpy = vi
        .spyOn(service, 'listAllWorkflows')
        .mockResolvedValueOnce(mockList);

      const res = await request(app)
        .get('/api/onboarding')
        .query({ employeeId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(listSpy).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: org1 }),
        { employeeId, status: undefined },
      );
    });
  });

  // 6. Created workflow is persisted correctly
  describe('6. Created workflow persistence logic', () => {
    it('service.createWorkflow creates onboarding workflow and seeds checklist steps correctly', async () => {
      const ctx = createSuperAdminContext(org1);
      const wfId = randomUUID();

      const mockTx = {
        maybeOne: vi.fn().mockResolvedValue({ id: employeeId, reportsTo: managerId }),
      } as unknown as Tx;

      vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn(mockTx));
      const createRepoSpy = vi
        .spyOn(repo, 'createOnboardingWorkflow')
        .mockResolvedValueOnce({ id: wfId, status: 'in_progress' });
      const findRepoSpy = vi
        .spyOn(repo, 'findWorkflowById')
        .mockResolvedValueOnce(sampleWorkflow(org1, employeeId, { id: wfId }));

      const result = await service.createWorkflow(ctx, {
        employeeId,
        startDate: '2026-10-05',
        managerId,
      });

      expect(result.id).toBe(wfId);
      expect(result.employeeId).toBe(employeeId);
      expect(createRepoSpy).toHaveBeenCalledWith(mockTx, {
        organizationId: org1,
        employeeId,
        createdBy: ctx.principal.id,
        startDate: '2026-10-05',
        managerId,
      });
      expect(findRepoSpy).toHaveBeenCalledWith(mockTx, org1, wfId);
    });

    it('verifies SEEDED_ONBOARDING_STEPS contains all 9 PRD ON-1 checklist steps', () => {
      expect(SEEDED_ONBOARDING_STEPS).toHaveLength(9);
      const codes = SEEDED_ONBOARDING_STEPS.map((s) => s.code);
      expect(codes).toContain('issue_credentials');
      expect(codes).toContain('assign_placement');
      expect(codes).toContain('assign_shift');
      expect(codes).toContain('map_biometric_pin');
      expect(codes).toContain('set_break_policy');
      expect(codes).toContain('collect_documents');
      expect(codes).toContain('issue_assets');
      expect(codes).toContain('manager_intro');
      expect(codes).toContain('set_probation_review');
    });
  });
});
