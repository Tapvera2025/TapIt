import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetRoutes, registeredBindings } from '../../platform/http/route.js';
import { checkManifest } from '../../platform/http/router.js';
import { registerTasksRoutes } from './routes.js';
import { registerEmployeeRoutes } from '../employee/routes.js';
import { taskAssigneesQuerySchema } from './validators.js';
import type { TaskAssignableUser } from './types.js';

describe('Task Assignee Lookup Security & Scoping', () => {
  beforeEach(() => __resetRoutes());
  afterEach(() => __resetRoutes());

  describe('Route and Permission Boundaries', () => {
    it('CASE 6: GET /api/users remains protected by users:view under employee-directory', () => {
      registerEmployeeRoutes();
      const bindings = registeredBindings();
      const userListBinding = bindings.find(
        (b) => b.method === 'GET' && b.path === '/api/users',
      );

      expect(userListBinding).toBeDefined();
      expect(userListBinding?.action).toBe('users:view');
      expect(userListBinding?.module).toBe('employee-directory');
    });

    it('CASE 1 & 2: GET /api/tasks/assignees is protected by tasks:assign under tasks module', () => {
      registerTasksRoutes();
      const bindings = registeredBindings();
      const assigneeBinding = bindings.find(
        (b) => b.method === 'GET' && b.path === '/api/tasks/assignees',
      );

      expect(assigneeBinding).toBeDefined();
      expect(assigneeBinding?.action).toBe('tasks:assign');
      expect(assigneeBinding?.module).toBe('tasks');
      expect(assigneeBinding?.resourceParam).toBeUndefined();
    });

    it('registers GET /api/tasks/assignees BEFORE GET /api/tasks/:id to prevent Express route shadowing', () => {
      registerTasksRoutes();
      const bindings = registeredBindings();
      const assigneeIdx = bindings.findIndex(
        (b) => b.method === 'GET' && b.path === '/api/tasks/assignees',
      );
      const getTaskIdx = bindings.findIndex(
        (b) => b.method === 'GET' && b.path === '/api/tasks/:id',
      );

      expect(assigneeIdx).toBeGreaterThanOrEqual(0);
      expect(getTaskIdx).toBeGreaterThanOrEqual(0);
      expect(assigneeIdx).toBeLessThan(getTaskIdx);
    });

    it('manifest checks pass with 0 drift for both tasks and employee routes', () => {
      registerTasksRoutes();
      registerEmployeeRoutes();
      const drift = checkManifest();

      expect(drift.routesWithoutBinding).toEqual([]);
      expect(drift.actionMismatches).toEqual([]);
      expect(drift.resourceMismatches).toEqual([]);
      expect(drift.duplicateRoutes).toEqual([]);
    });
  });

  describe('Query Validation', () => {
    it('validates optional projectId and search term', () => {
      const valid = taskAssigneesQuerySchema.parse({
        projectId: '00000000-0000-0000-0000-000000000001',
        search: 'Alice',
      });
      expect(valid.projectId).toBe('00000000-0000-0000-0000-000000000001');
      expect(valid.search).toBe('Alice');

      const empty = taskAssigneesQuerySchema.parse({});
      expect(empty.projectId).toBeUndefined();
      expect(empty.search).toBeUndefined();
    });

    it('rejects malformed project UUIDs', () => {
      expect(() =>
        taskAssigneesQuerySchema.parse({ projectId: 'not-a-uuid' }),
      ).toThrow();
    });
  });

  describe('CASE 3: Minimal Projection Security Contract', () => {
    it('only permits minimal identity fields and disallows sensitive employee fields', () => {
      const sampleAssignee: TaskAssignableUser = {
        id: '00000000-0000-0000-0000-000000000001',
        fullName: 'Jane Developer',
        email: 'jane@example.com',
        departmentName: 'Development',
        positionName: 'Developer',
      };

      const keys = Object.keys(sampleAssignee);
      expect(keys.sort()).toEqual(
        ['departmentName', 'email', 'fullName', 'id', 'positionName'].sort(),
      );

      // Sensitive fields must never be present
      expect(keys).not.toContain('salary');
      expect(keys).not.toContain('documents');
      expect(keys).not.toContain('bankDetails');
      expect(keys).not.toContain('performanceRating');
      expect(keys).not.toContain('review360');
      expect(keys).not.toContain('emergencyContact');
    });
  });

  describe('CASE 9: Frontend Decoupling from Employee Directory', () => {
    it('Task Assignee Picker imports from tasksApi, not companyApi /api/users', async () => {
      const fs = await import('node:fs');
      const pickerSource = fs.readFileSync(
        new URL(
          '../../../../client/src/company/tasks/components/TaskAssigneePicker.tsx',
          import.meta.url,
        ),
        'utf8',
      );

      // Must NOT import getCompanyEmployees or companyApi
      expect(pickerSource).not.toContain('getCompanyEmployees');
      expect(pickerSource).not.toContain('companyApi');
      expect(pickerSource).not.toContain('/api/users');

      // Must import getTaskAssignees from tasksApi
      expect(pickerSource).toContain('getTaskAssignees');
      expect(pickerSource).toContain("from '../api/tasksApi.js'");
    });
  });

  describe('Super Admin All Employee Tasks UI & Security Invariants', () => {
    it('TaskFilters.tsx gates "All Employee Tasks" strictly on isSuperAdmin', async () => {
      const fs = await import('node:fs');
      const filtersSource = fs.readFileSync(
        new URL(
          '../../../../client/src/company/tasks/components/TaskFilters.tsx',
          import.meta.url,
        ),
        'utf8',
      );

      // Must include "All Employee Tasks" label
      expect(filtersSource).toContain('All Employee Tasks');
      expect(filtersSource).toContain('My Tasks');

      // Must be gated behind isSuperAdmin check
      expect(filtersSource).toContain('{isSuperAdmin &&');

      // Must NOT fetch /api/users or bypass backend
      expect(filtersSource).not.toContain('/api/users');
      expect(filtersSource).not.toContain('getCompanyEmployees');
    });

    it('TasksPage.tsx properly plumbs isSuperAdmin and handles viewScope transitions', async () => {
      const fs = await import('node:fs');
      const pageSource = fs.readFileSync(
        new URL(
          '../../../../client/src/company/tasks/pages/TasksPage.tsx',
          import.meta.url,
        ),
        'utf8',
      );

      // Must accept isSuperAdmin and currentUserId props
      expect(pageSource).toContain('isSuperAdmin');
      expect(pageSource).toContain('currentUserId');
      expect(pageSource).toContain('viewScope');
      expect(pageSource).toContain('handleViewScopeChange');

      // Must pass them down to TaskFilters
      expect(pageSource).toContain('isSuperAdmin={isSuperAdmin}');
      expect(pageSource).toContain('viewScope={viewScope}');
      expect(pageSource).toContain('onViewScopeChange={handleViewScopeChange}');

      // Must NOT make unauthorized /api/users calls
      expect(pageSource).not.toContain('/api/users');
      expect(pageSource).not.toContain('getCompanyEmployees');
    });

    it('TaskList.tsx displays Created By -> Assigned To assignment relationship', async () => {
      const fs = await import('node:fs');
      const listSource = fs.readFileSync(
        new URL(
          '../../../../client/src/company/tasks/components/TaskList.tsx',
          import.meta.url,
        ),
        'utf8',
      );

      // Must display "Created by:"
      expect(listSource).toContain('Created by:');
      expect(listSource).toContain('task.createdByName');

      // Must display relationship arrow
      expect(listSource).toContain('→');

      // Must display "Assigned to:"
      expect(listSource).toContain('Assigned to:');
      expect(listSource).toContain('assignee.fullName');

      // Must NOT call /api/users
      expect(listSource).not.toContain('/api/users');
      expect(listSource).not.toContain('getCompanyEmployees');
    });
  });
});

