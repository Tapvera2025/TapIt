import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authorize,
  configureAuthz,
  registerProtectedConstraints,
  __resetConstraints,
  __resetResourcePolicies,
  AuthorizationError,
  type PolicyEvaluationContext,
  type Resource,
} from '@tapcrm/authz';
import { globalAccess, type PermissionPolicy } from '@tapcrm/contracts';
import { registerTasksPolicies, taskPolicy } from './policy.js';
import type { Tx } from '../../platform/dal/db.js';
import {
  expandPermissionCell,
  provisionDefaultPositionPolicies,
  type RegistryActionDefinition,
} from '../../platform/organizations/policy-matrix.js';
import { ORGANIZATION_TEMPLATE } from '../../platform/organizations/template.js';

describe('HR Task Authorization — Position -> Policy -> Action -> Scope', () => {
  const organizationId = randomUUID();
  const hrDeptId = randomUUID();
  const salesDeptId = randomUUID();
  const hrUserId = randomUUID();
  const hrColleagueId = randomUUID();
  const salesUserId = randomUUID();

  function makeContext(options: {
    userId: string;
    accountType: 'employee' | 'super-admin';
    departmentId?: string | null;
    policies?: Record<string, PermissionPolicy>;
  }): PolicyEvaluationContext {
    return {
      organizationId,
      requestId: `req-${options.userId}`,
      memo: new Map(),
      principal: {
        id: options.userId,
        organizationId,
        accountType: options.accountType,
        departmentId: options.departmentId ?? null,
      } as PolicyEvaluationContext['principal'],
      scope: {
        departmentId: async () => options.departmentId ?? null,
        teamIds: async () => new Set<string>(),
        poolIds: async () => new Set<string>(),
        subordinateIds: async () => new Set<string>(),
        poolMemberIds: async () => new Set<string>(),
      },
    };
  }

  function taskResource(overrides: Record<string, unknown> = {}): Resource {
    return {
      type: 'task',
      id: randomUUID(),
      organizationId,
      createdBy: hrColleagueId,
      assignedTo: hrColleagueId,
      departmentId: hrDeptId,
      departmentIds: [hrDeptId],
      assigneeDepartmentIds: [hrDeptId],
      ...overrides,
    };
  }

  const hrPolicies: Record<string, PermissionPolicy> = {
    'tasks:view': {
      action: 'tasks:view',
      allowed: true,
      scope: 'department',
      source: 'position',
    },
    'tasks:assign': {
      action: 'tasks:assign',
      allowed: true,
      scope: 'department',
      source: 'position',
    },
    'tasks:update': {
      action: 'tasks:update',
      allowed: true,
      scope: 'department',
      source: 'position',
    },
    'tasks:review': {
      action: 'tasks:review',
      allowed: true,
      scope: 'department',
      source: 'position',
    },
    'tasks:manage-dependencies': {
      action: 'tasks:manage-dependencies',
      allowed: true,
      scope: 'department',
      source: 'position',
    },
    'tasks:log-time': {
      action: 'tasks:log-time',
      allowed: true,
      scope: 'department',
      source: 'position',
    },
  };

  const auditEvents: Array<{ stream: string; event: string }> = [];

  beforeEach(() => {
    __resetConstraints();
    __resetResourcePolicies();
    registerProtectedConstraints();
    registerTasksPolicies();
    auditEvents.length = 0;

    configureAuthz({
      scope: {
        subordinateIds: async () => new Set(),
        teamIds: async () => new Set(),
        poolIds: async () => new Set(),
        poolMemberIds: async () => new Set(),
        departmentId: async (ctx) =>
          ctx.principal.accountType === 'employee' ? ctx.principal.departmentId : null,
      },
      policies: {
        resolveSet: async (ctx) => {
          if (ctx.principal.id === hrUserId) {
            return {
              policies: hrPolicies,
              cacheDeadline: new Date(Date.now() + 60_000),
              resolvedAt: new Date(),
            };
          }
          if (globalAccess(ctx.principal)) {
            return {
              policies: {},
              cacheDeadline: new Date(Date.now() + 60_000),
              resolvedAt: new Date(),
            };
          }
          // Default regular employee with 'own' scope
          return {
            policies: {
              'tasks:view': { action: 'tasks:view', allowed: true, scope: 'own', source: 'position' },
              'tasks:update': { action: 'tasks:update', allowed: true, scope: 'own', source: 'position' },
              'tasks:assign': { action: 'tasks:assign', allowed: true, scope: 'own', source: 'position' },
            },
            cacheDeadline: new Date(Date.now() + 60_000),
            resolvedAt: new Date(),
          };
        },
      },
      audit: {
        sensitiveUse: () => {},
        superAdminBypass: () => {},
        segregationBlocked: () => {
          auditEvents.push({ stream: 'security', event: 'sod_self' });
        },
        defect: () => {},
      },
      now: () => new Date(),
    });
  });

  // 1. HR receives tasks:view
  it('1. HR receives tasks:view with department scope', async () => {
    const hrCtx = makeContext({
      userId: hrUserId,
      accountType: 'employee',
      departmentId: hrDeptId,
      policies: hrPolicies,
    });

    const res = taskResource({ departmentId: hrDeptId });
    await expect(authorize(hrCtx, 'tasks:view', res)).resolves.toBeUndefined();
  });

  // 2. HR can list Tasks via filter
  it('2. HR can list Tasks within their department', async () => {
    const hrCtx = makeContext({
      userId: hrUserId,
      accountType: 'employee',
      departmentId: hrDeptId,
      policies: hrPolicies,
    });

    const filter = await taskPolicy.filter(hrCtx, 'tasks:view', 'department');
    expect(filter.sql).toContain('u.department_id = $1');
    expect(filter.parameters).toEqual([hrDeptId]);
  });

  // 3. HR can create Tasks (authorized under tasks:assign)
  it('3. HR can create Tasks under tasks:assign', async () => {
    const hrCtx = makeContext({
      userId: hrUserId,
      accountType: 'employee',
      departmentId: hrDeptId,
      policies: hrPolicies,
    });

    // tasks:assign route at POST /api/tasks evaluates tasks:assign without target resource
    await expect(authorize(hrCtx, 'tasks:assign', undefined)).resolves.toBeUndefined();
  });

  // 4. HR can assign Tasks within department
  it('4. HR can assign Tasks within their department', async () => {
    const hrCtx = makeContext({
      userId: hrUserId,
      accountType: 'employee',
      departmentId: hrDeptId,
      policies: hrPolicies,
    });

    const res = taskResource({ departmentId: hrDeptId });
    await expect(authorize(hrCtx, 'tasks:assign', res)).resolves.toBeUndefined();
  });

  // 5. HR can update/manage Tasks within department
  it('5. HR can update/manage Tasks within their department', async () => {
    const hrCtx = makeContext({
      userId: hrUserId,
      accountType: 'employee',
      departmentId: hrDeptId,
      policies: hrPolicies,
    });

    const res = taskResource({ departmentId: hrDeptId });
    await expect(authorize(hrCtx, 'tasks:update', res)).resolves.toBeUndefined();
  });

  // 6. HR can review Tasks where policy scope permits, and SoD prevents self-review
  it('6. HR can review Tasks in department, and SoD blocks self-review if assigned to HR', async () => {
    const hrCtx = makeContext({
      userId: hrUserId,
      accountType: 'employee',
      departmentId: hrDeptId,
      policies: hrPolicies,
    });

    // Reviewing colleague's task in HR department -> permitted
    const colleagueTask = taskResource({
      departmentId: hrDeptId,
      assignedTo: hrColleagueId,
    });
    await expect(authorize(hrCtx, 'tasks:review', colleagueTask)).resolves.toBeUndefined();

    // Reviewing own assigned task -> BLOCKED by SoD (A1 / SD-5)
    const selfAssignedTask = taskResource({
      departmentId: hrDeptId,
      assignedTo: hrUserId,
    });
    await expect(authorize(hrCtx, 'tasks:review', selfAssignedTask)).rejects.toThrow(
      AuthorizationError,
    );
    expect(auditEvents).toContainEqual({ stream: 'security', event: 'sod_self' });
  });

  // 7. HR cannot access Tasks outside the granted department scope
  it('7. HR cannot access Tasks outside the granted department scope', async () => {
    const hrCtx = makeContext({
      userId: hrUserId,
      accountType: 'employee',
      departmentId: hrDeptId,
      policies: hrPolicies,
    });

    const salesTask = taskResource({
      departmentId: salesDeptId,
      departmentIds: [salesDeptId],
      assigneeDepartmentIds: [salesDeptId],
      createdBy: salesUserId,
      assignedTo: salesUserId,
    });

    await expect(authorize(hrCtx, 'tasks:view', salesTask)).rejects.toThrow(AuthorizationError);
    await expect(authorize(hrCtx, 'tasks:assign', salesTask)).rejects.toThrow(AuthorizationError);
    await expect(authorize(hrCtx, 'tasks:update', salesTask)).rejects.toThrow(AuthorizationError);
    await expect(authorize(hrCtx, 'tasks:review', salesTask)).rejects.toThrow(AuthorizationError);
  });

  // 8. Existing employee task permissions remain unchanged (own scope)
  it('8. Existing regular employee task permissions remain unchanged', async () => {
    const empCtx = makeContext({
      userId: salesUserId,
      accountType: 'employee',
      departmentId: salesDeptId,
    });

    // Regular employee can view own task
    const ownTask = taskResource({
      departmentId: salesDeptId,
      createdBy: salesUserId,
      assignedTo: salesUserId,
    });
    await expect(authorize(empCtx, 'tasks:view', ownTask)).resolves.toBeUndefined();

    // Regular employee cannot view other employee task
    const otherTask = taskResource({
      departmentId: salesDeptId,
      createdBy: hrColleagueId,
      assignedTo: hrColleagueId,
    });
    await expect(authorize(empCtx, 'tasks:view', otherTask)).rejects.toThrow(AuthorizationError);

    // Regular employee without tasks:review cannot review tasks
    await expect(authorize(empCtx, 'tasks:review', ownTask)).rejects.toThrow(AuthorizationError);
  });

  // 9. Super Admin behavior remains unchanged
  it('9. Super Admin behavior remains unchanged (unrestricted access across departments)', async () => {
    const adminCtx = makeContext({
      userId: randomUUID(),
      accountType: 'super-admin',
      departmentId: null,
    });

    const anyTask = taskResource({
      departmentId: salesDeptId,
      createdBy: salesUserId,
      assignedTo: salesUserId,
    });

    await expect(authorize(adminCtx, 'tasks:view', anyTask)).resolves.toBeUndefined();
    await expect(authorize(adminCtx, 'tasks:update', anyTask)).resolves.toBeUndefined();
    await expect(authorize(adminCtx, 'tasks:assign', anyTask)).resolves.toBeUndefined();
  });

  // 10. Existing organizations receive the new HR policy rows (migration verification)
  it('10. Existing organizations receive the new HR policy rows', async () => {
    const actions: RegistryActionDefinition[] = [
      { action: 'tasks:view', module: 'tasks', positionGrantable: true, superAdminOnly: false },
      { action: 'tasks:assign', module: 'tasks', positionGrantable: true, superAdminOnly: false },
      { action: 'tasks:update', module: 'tasks', positionGrantable: true, superAdminOnly: false },
      { action: 'tasks:review', module: 'tasks', positionGrantable: true, superAdminOnly: false },
      { action: 'tasks:manage-dependencies', module: 'tasks', positionGrantable: true, superAdminOnly: false },
      { action: 'tasks:log-time', module: 'tasks', positionGrantable: true, superAdminOnly: false },
    ];
    const actionsMap = new Map([['tasks', actions]]);

    const emitted = expandPermissionCell('tasks', 'department', 'hr', actionsMap);
    expect(emitted).toHaveLength(6);
    expect(emitted.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'tasks:view',
        'tasks:assign',
        'tasks:update',
        'tasks:review',
        'tasks:manage-dependencies',
        'tasks:log-time',
      ]),
    );
    expect(emitted.every((e) => e.scope === 'department')).toBe(true);
  });

  // 11. New organizations receive the permissions from the canonical matrix
  it('11. New organizations receive the permissions from the canonical matrix', async () => {
    const hrPos = ORGANIZATION_TEMPLATE.positions.find((p) => p.code === 'hr')!;
    const hrExecPos = ORGANIZATION_TEMPLATE.positions.find((p) => p.code === 'hr-executive')!;

    const insertedRows: Array<{ positionId: string; action: string; scope: string }> = [];
    const mockTx = {
      async query<T>(fragment: { sql: string; parameters?: unknown[] }): Promise<T[]> {
        if (fragment.sql.includes('FROM registry_action')) {
          return [
            { action: 'tasks:view', module: 'tasks', positionGrantable: true, superAdminOnly: false },
            { action: 'tasks:assign', module: 'tasks', positionGrantable: true, superAdminOnly: false },
            { action: 'tasks:update', module: 'tasks', positionGrantable: true, superAdminOnly: false },
            { action: 'tasks:review', module: 'tasks', positionGrantable: true, superAdminOnly: false },
          ] as T[];
        }
        if (fragment.sql.includes('INSERT INTO position_policy')) {
          const [, positionId, action, scope] = fragment.parameters as [string, string, string, string];
          insertedRows.push({ positionId, action, scope });
          return [{ inserted: true }] as unknown as T[];
        }
        return [];
      },
      async one() { return {}; },
      async maybeOne() { return null; },
    };

    const count = await provisionDefaultPositionPolicies(
      mockTx as unknown as Tx,
      'org-test',
      ['tasks'],
      [hrPos, hrExecPos],
      new Map([['hr', 'pos-hr'], ['hr-executive', 'pos-hr-exec']]),
    );

    expect(count).toBe(8); // 4 actions * 2 positions
    expect(insertedRows.filter((r) => r.positionId === 'pos-hr').map((r) => r.action)).toEqual(
      expect.arrayContaining(['tasks:view', 'tasks:assign', 'tasks:update', 'tasks:review']),
    );
    expect(insertedRows.every((r) => r.scope === 'department')).toBe(true);
  });

  // 12. No duplicate position_policy rows are created
  it('12. No duplicate position_policy rows are created on re-provisioning', async () => {
    const existingKeys = new Set<string>();
    const mockTx = {
      async query<T>(fragment: { sql: string; parameters?: unknown[] }): Promise<T[]> {
        if (fragment.sql.includes('FROM registry_action')) {
          return [
            { action: 'tasks:view', module: 'tasks', positionGrantable: true, superAdminOnly: false },
            { action: 'tasks:assign', module: 'tasks', positionGrantable: true, superAdminOnly: false },
          ] as unknown as T[];
        }
        if (fragment.sql.includes('INSERT INTO position_policy')) {
          const [, positionId, action] = fragment.parameters as [string, string, string];
          const key = `${positionId}:${action}`;
          if (existingKeys.has(key)) return []; // Simulated ON CONFLICT DO NOTHING
          existingKeys.add(key);
          return [{ inserted: true }] as unknown as T[];
        }
        return [];
      },
      async one() { return {}; },
      async maybeOne() { return null; },
    };

    const hrPos = ORGANIZATION_TEMPLATE.positions.find((p) => p.code === 'hr')!;
    const firstRun = await provisionDefaultPositionPolicies(
      mockTx as unknown as Tx,
      'org-test',
      ['tasks'],
      [hrPos],
      new Map([['hr', 'pos-hr']]),
    );
    expect(firstRun).toBe(2);

    const secondRun = await provisionDefaultPositionPolicies(
      mockTx as unknown as Tx,
      'org-test',
      ['tasks'],
      [hrPos],
      new Map([['hr', 'pos-hr']]),
    );
    expect(secondRun).toBe(0);
  });

  // 13. Existing customized policy rows are not overwritten
  it('13. Existing customized policy rows are not overwritten', async () => {
    const positionPolicies = new Map<string, { scope: string }>([
      ['pos-hr:tasks:view', { scope: 'own' }], // Custom override by tenant
    ]);

    const mockTx = {
      async query<T>(fragment: { sql: string; parameters?: unknown[] }): Promise<T[]> {
        if (fragment.sql.includes('FROM registry_action')) {
          return [
            { action: 'tasks:view', module: 'tasks', positionGrantable: true, superAdminOnly: false },
            { action: 'tasks:assign', module: 'tasks', positionGrantable: true, superAdminOnly: false },
          ] as unknown as T[];
        }
        if (fragment.sql.includes('INSERT INTO position_policy')) {
          const [, positionId, action, scope] = fragment.parameters as [string, string, string, string];
          const key = `${positionId}:${action}`;
          if (positionPolicies.has(key)) return []; // DO NOTHING
          positionPolicies.set(key, { scope });
          return [{ inserted: true }] as unknown as T[];
        }
        return [];
      },
      async one() { return {}; },
      async maybeOne() { return null; },
    };

    const hrPos = ORGANIZATION_TEMPLATE.positions.find((p) => p.code === 'hr')!;
    await provisionDefaultPositionPolicies(
      mockTx as unknown as Tx,
      'org-test',
      ['tasks'],
      [hrPos],
      new Map([['hr', 'pos-hr']]),
    );

    // tasks:view preserved custom 'own' scope
    expect(positionPolicies.get('pos-hr:tasks:view')?.scope).toBe('own');
    // missing tasks:assign received default 'department' scope
    expect(positionPolicies.get('pos-hr:tasks:assign')?.scope).toBe('department');
  });
});
