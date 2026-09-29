import { beforeEach, describe, expect, it } from 'vitest';
import {
  authorize,
  configureAuthz,
  MATCH_NOTHING,
  registerProtectedConstraints,
  __resetConstraints,
  __resetResourcePolicies,
  AuthorizationError,
  type PolicyEvaluationContext,
} from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';
import { registerTasksPolicies, taskPolicy } from './policy.js';

const organizationId = '00000000-0000-0000-0000-000000000001';

function mockContext(): PolicyEvaluationContext {
  return {
    organizationId,
    requestId: 'req-test-1',
    memo: new Map(),
    principal: {
      id: 'user-emp-1',
      organizationId,
      accountType: 'employee',
      departmentId: 'dept-1',
      teamId: 'team-1',
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'dept-1',
      teamIds: async () => new Set(['team-1', 'team-2']),
      poolIds: async () => new Set(['team-1']),
      subordinateIds: async () => new Set(['user-emp-2']),
      poolMemberIds: async () => new Set(['user-emp-1', 'user-emp-2']),
    },
  };
}

function makeTeamContext(options: {
  principalTeamId?: string | null;
  resolvedTeamIds?: string[];
}): PolicyEvaluationContext {
  const principalTeamId =
    options.principalTeamId !== undefined ? options.principalTeamId : 'team-A';
  const resolvedTeamIds =
    options.resolvedTeamIds ?? (principalTeamId ? [principalTeamId] : []);

  return {
    organizationId,
    requestId: 'req-test-team',
    memo: new Map(),
    principal: {
      id: 'user-emp-1',
      organizationId,
      accountType: 'employee',
      departmentId: 'dept-1',
      teamId: principalTeamId,
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'dept-1',
      teamIds: async () => new Set(resolvedTeamIds),
      poolIds: async () => new Set(),
      subordinateIds: async () => new Set(),
      poolMemberIds: async () => new Set(),
    },
  };
}

function makeDepartmentContext(options: {
  principalDepartmentId?: string | null;
  resolvedDepartmentId?: string | null;
}): PolicyEvaluationContext {
  const principalDepartmentId =
    options.principalDepartmentId !== undefined
      ? options.principalDepartmentId
      : 'dept-A';
  const resolvedDepartmentId =
    options.resolvedDepartmentId !== undefined
      ? options.resolvedDepartmentId
      : principalDepartmentId;

  return {
    organizationId,
    requestId: 'req-test-dept',
    memo: new Map(),
    principal: {
      id: 'user-emp-1',
      organizationId,
      accountType: 'employee',
      departmentId: principalDepartmentId,
      teamId: 'team-1',
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => resolvedDepartmentId,
      teamIds: async () => new Set(),
      poolIds: async () => new Set(),
      subordinateIds: async () => new Set(),
      poolMemberIds: async () => new Set(),
    },
  };
}

function makePoolContext(options: {
  principalTeamId?: string | null;
  resolvedPoolIds?: string[];
  resolvedPoolMemberIds?: string[];
}): PolicyEvaluationContext {
  const principalTeamId =
    options.principalTeamId !== undefined
      ? options.principalTeamId
      : 'pool-1';
  const resolvedPoolIds =
    options.resolvedPoolIds !== undefined
      ? options.resolvedPoolIds
      : principalTeamId ? [principalTeamId] : [];
  const resolvedPoolMemberIds =
    options.resolvedPoolMemberIds !== undefined
      ? options.resolvedPoolMemberIds
      : ['user-pool-1', 'user-pool-2'];

  return {
    organizationId,
    requestId: 'req-test-pool',
    memo: new Map(),
    principal: {
      id: 'user-supervisor-1',
      organizationId,
      accountType: 'employee',
      departmentId: 'dept-sales',
      teamId: principalTeamId,
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'dept-sales',
      teamIds: async () => new Set(resolvedPoolIds),
      poolIds: async () => new Set(resolvedPoolIds),
      subordinateIds: async () => new Set(),
      poolMemberIds: async () => new Set(resolvedPoolMemberIds),
    },
  };
}



function taskResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'task',
    id: 'task-1',
    organizationId,
    createdBy: 'user-creator',
    assignedTo: 'user-emp-2',
    assigneeIds: ['user-emp-2'],
    status: 'pending',
    priority: 'medium',
    ...overrides,
  };
}

describe('Task policy authorization', () => {
  it.each<Scope>(['own', 'participant', 'department', 'team', 'pool'])(
    'denies cross-tenant task access for %s scope',
    async (scope) => {
      const ctx = mockContext();
      const crossTenantTask = taskResource({
        organizationId: 'other-org-id',
        createdBy: ctx.principal.id,
      });

      const allowed = await taskPolicy.check(
        ctx,
        'tasks:view',
        crossTenantTask,
        scope,
      );
      expect(allowed).toBe(false);
    },
  );

  describe('own scope', () => {
    it('allows access when user is the creator', async () => {
      const ctx = mockContext();
      const res = taskResource({ createdBy: ctx.principal.id });
      expect(await taskPolicy.check(ctx, 'tasks:view', res, 'own')).toBe(true);
    });

    it('allows access when user is the primary assignee (assignedTo)', async () => {
      const ctx = mockContext();
      const res = taskResource({
        createdBy: 'other-user',
        assignedTo: ctx.principal.id,
      });
      expect(await taskPolicy.check(ctx, 'tasks:view', res, 'own')).toBe(true);
    });

    it('allows access when user is in the assigneeIds array', async () => {
      const ctx = mockContext();
      const res = taskResource({
        createdBy: 'other-user',
        assignedTo: 'other-user-2',
        assigneeIds: ['other-user-2', ctx.principal.id],
      });
      expect(await taskPolicy.check(ctx, 'tasks:view', res, 'own')).toBe(true);
    });

    it('denies access when user is not creator or assignee', async () => {
      const ctx = mockContext();
      const res = taskResource({
        createdBy: 'other-user',
        assignedTo: 'other-user-2',
        assigneeIds: ['other-user-2'],
      });
      expect(await taskPolicy.check(ctx, 'tasks:view', res, 'own')).toBe(false);
    });
  });

  describe('participant scope', () => {
    it('allows access when user is among assignees', async () => {
      const ctx = mockContext();
      const res = taskResource({
        assigneeIds: ['another-user', ctx.principal.id],
      });
      expect(await taskPolicy.check(ctx, 'tasks:view', res, 'participant')).toBe(true);
    });

    it('denies access when user is neither creator nor assignee', async () => {
      const ctx = mockContext();
      const res = taskResource({
        createdBy: 'other-user',
        assignedTo: 'other-user-2',
        assigneeIds: ['other-user-2'],
      });
      expect(await taskPolicy.check(ctx, 'tasks:view', res, 'participant')).toBe(false);
    });
  });

  describe('team scope object-level authorization', () => {
    // Hierarchy: Team A -> Team B -> Team C -> Team D; Unrelated: Team X, Team Y
    const teamHierarchyContext = makeTeamContext({
      principalTeamId: 'team-A',
      resolvedTeamIds: ['team-A', 'team-B', 'team-C', 'team-D'],
    });

    it('TEST 1: User belongs to Team A, Task belongs to Team A -> ALLOW', async () => {
      const res = taskResource({ teamId: 'team-A' });
      const allowed = await taskPolicy.check(
        teamHierarchyContext,
        'tasks:view',
        res,
        'team',
      );
      expect(allowed).toBe(true);
    });

    it('TEST 2: User belongs to Team A, Task belongs to direct child Team B -> ALLOW', async () => {
      const res = taskResource({ teamId: 'team-B' });
      const allowed = await taskPolicy.check(
        teamHierarchyContext,
        'tasks:view',
        res,
        'team',
      );
      expect(allowed).toBe(true);
    });

    it('TEST 3: User belongs to Team A, Task belongs to grandchild Team C -> ALLOW', async () => {
      const res = taskResource({ teamId: 'team-C' });
      const allowed = await taskPolicy.check(
        teamHierarchyContext,
        'tasks:view',
        res,
        'team',
      );
      expect(allowed).toBe(true);
    });

    it('TEST 4: User belongs to Team A, Task belongs to sibling/unrelated Team X -> DENY', async () => {
      const res = taskResource({ teamId: 'team-X' });
      const allowed = await taskPolicy.check(
        teamHierarchyContext,
        'tasks:view',
        res,
        'team',
      );
      expect(allowed).toBe(false);
    });

    it('TEST 5: User belongs to Team A, Task belongs to a completely unrelated hierarchy -> DENY', async () => {
      const res = taskResource({ teamId: 'unrelated-hierarchy-team-999' });
      const allowed = await taskPolicy.check(
        teamHierarchyContext,
        'tasks:view',
        res,
        'team',
      );
      expect(allowed).toBe(false);
    });

    it('TEST 6: User has Team scope but team resolution returns no valid team -> DENY', async () => {
      const noTeamCtx = makeTeamContext({
        principalTeamId: null,
        resolvedTeamIds: [],
      });
      const res = taskResource({ teamId: 'team-A' });
      const allowed = await taskPolicy.check(
        noTeamCtx,
        'tasks:view',
        res,
        'team',
      );
      expect(allowed).toBe(false);
    });

    it('TEST 11: Team scope must not accidentally become organization-wide access', async () => {
      // In a tenant with multiple arbitrary teams, only teams in transitive descent are allowed
      const arbitraryTeams = [
        'team-marketing',
        'team-sales-east',
        'team-hr',
        'team-finance',
      ];
      for (const arbitraryTeam of arbitraryTeams) {
        const res = taskResource({ teamId: arbitraryTeam });
        const allowed = await taskPolicy.check(
          teamHierarchyContext,
          'tasks:view',
          res,
          'team',
        );
        expect(allowed).toBe(false);
      }
    });

    it('TEST 12: Parent/child hierarchy works transitively (A -> B -> C -> D)', async () => {
      // Great-grandchild Team D is reachable from root Team A
      const resD = taskResource({ teamId: 'team-D' });
      expect(
        await taskPolicy.check(teamHierarchyContext, 'tasks:view', resD, 'team'),
      ).toBe(true);

      // Child context starting at Team B cannot reach sibling or parent Team A
      const teamBContext = makeTeamContext({
        principalTeamId: 'team-B',
        resolvedTeamIds: ['team-B', 'team-C', 'team-D'],
      });
      const resA = taskResource({ teamId: 'team-A' });
      expect(
        await taskPolicy.check(teamBContext, 'tasks:view', resA, 'team'),
      ).toBe(false);
    });

    describe('TEST 14: Security regression test scenario', () => {
      // Principal in Team A
      // Hierarchy: Team A -> Team B -> Team C
      // Unrelated: Team X
      const regressionCtx = makeTeamContext({
        principalTeamId: 'team-A',
        resolvedTeamIds: ['team-A', 'team-B', 'team-C'],
      });

      it('correctly grants in-scope descendants and strictly denies Task X', async () => {
        const taskA = taskResource({ id: 'task-A', teamId: 'team-A' });
        const taskB = taskResource({ id: 'task-B', teamId: 'team-B' });
        const taskC = taskResource({ id: 'task-C', teamId: 'team-C' });
        const taskX = taskResource({ id: 'task-X', teamId: 'team-X' });

        expect(
          await taskPolicy.check(regressionCtx, 'tasks:view', taskA, 'team'),
        ).toBe(true);
        expect(
          await taskPolicy.check(regressionCtx, 'tasks:view', taskB, 'team'),
        ).toBe(true);
        expect(
          await taskPolicy.check(regressionCtx, 'tasks:view', taskC, 'team'),
        ).toBe(true);
        // CRITICAL: Task X must NEVER be allowed simply because Team A exists
        expect(
          await taskPolicy.check(regressionCtx, 'tasks:view', taskX, 'team'),
        ).toBe(false);
      });
    });

    describe('creator and assignee team relationship resolution', () => {
      it('allows task when creatorTeamId matches user team scope', async () => {
        const res = taskResource({ creatorTeamId: 'team-B' });
        expect(
          await taskPolicy.check(teamHierarchyContext, 'tasks:view', res, 'team'),
        ).toBe(true);
      });

      it('denies task when creatorTeamId is outside team scope', async () => {
        const res = taskResource({ creatorTeamId: 'team-X' });
        expect(
          await taskPolicy.check(teamHierarchyContext, 'tasks:view', res, 'team'),
        ).toBe(false);
      });

      it('allows task when assigneeTeamIds contains an in-scope team', async () => {
        const res = taskResource({
          creatorTeamId: 'team-X',
          assigneeTeamIds: ['team-C'],
        });
        expect(
          await taskPolicy.check(teamHierarchyContext, 'tasks:view', res, 'team'),
        ).toBe(true);
      });

      it('denies task when creator and all assignees are outside team scope', async () => {
        const res = taskResource({
          creatorTeamId: 'team-X',
          assigneeTeamIds: ['team-Y', 'team-Z'],
        });
        expect(
          await taskPolicy.check(teamHierarchyContext, 'tasks:view', res, 'team'),
        ).toBe(false);
      });

      it('allows task when assignees array has an in-scope member team', async () => {
        const res = taskResource({
          assignees: [
            { id: 'user-2', fullName: 'User 2', teamId: 'team-B' },
          ],
        });
        expect(
          await taskPolicy.check(teamHierarchyContext, 'tasks:view', res, 'team'),
        ).toBe(true);
      });

      it('denies task when task has no team metadata and principal is not creator or assignee', async () => {
        const res = taskResource({
          createdBy: 'unrelated-user',
          assignedTo: 'unrelated-user-2',
          assigneeIds: ['unrelated-user-2'],
        });
        expect(
          await taskPolicy.check(teamHierarchyContext, 'tasks:view', res, 'team'),
        ).toBe(false);
      });
    });
  });

  describe('department scope object-level authorization', () => {
    const deptContext = makeDepartmentContext({
      principalDepartmentId: 'dept-A',
      resolvedDepartmentId: 'dept-A',
    });

    it('TEST 1: User belongs to Dept A, Task belongs to Dept A -> ALLOW', async () => {
      const res = taskResource({ departmentId: 'dept-A' });
      const allowed = await taskPolicy.check(
        deptContext,
        'tasks:view',
        res,
        'department',
      );
      expect(allowed).toBe(true);
    });

    it('TEST 2: User belongs to Dept A, Task belongs to Dept B -> DENY', async () => {
      const res = taskResource({ departmentId: 'dept-B' });
      const allowed = await taskPolicy.check(
        deptContext,
        'tasks:view',
        res,
        'department',
      );
      expect(allowed).toBe(false);
    });

    it('TEST 8: Missing department on principal/scope -> fail closed (DENY)', async () => {
      const noDeptContext = makeDepartmentContext({
        principalDepartmentId: null,
        resolvedDepartmentId: null,
      });
      const res = taskResource({ departmentId: 'dept-A' });
      const allowed = await taskPolicy.check(
        noDeptContext,
        'tasks:view',
        res,
        'department',
      );
      expect(allowed).toBe(false);
    });

    it('TEST 8: Task with no department metadata and unrelated users -> fail closed (DENY)', async () => {
      const res = taskResource({
        createdBy: 'unrelated-creator',
        assignedTo: 'unrelated-assignee',
        assigneeIds: ['unrelated-assignee'],
      });
      const allowed = await taskPolicy.check(
        deptContext,
        'tasks:view',
        res,
        'department',
      );
      expect(allowed).toBe(false);
    });

    describe('creator and assignee department relationship resolution', () => {
      it('allows task when creatorDepartmentId matches user department scope', async () => {
        const res = taskResource({ creatorDepartmentId: 'dept-A' });
        expect(
          await taskPolicy.check(deptContext, 'tasks:view', res, 'department'),
        ).toBe(true);
      });

      it('denies task when creatorDepartmentId is outside department scope', async () => {
        const res = taskResource({ creatorDepartmentId: 'dept-B' });
        expect(
          await taskPolicy.check(deptContext, 'tasks:view', res, 'department'),
        ).toBe(false);
      });

      it('allows task when assigneeDepartmentIds contains user department', async () => {
        const res = taskResource({
          creatorDepartmentId: 'dept-B',
          assigneeDepartmentIds: ['dept-A'],
        });
        expect(
          await taskPolicy.check(deptContext, 'tasks:view', res, 'department'),
        ).toBe(true);
      });

      it('denies task when creator and all assignees are outside department scope', async () => {
        const res = taskResource({
          creatorDepartmentId: 'dept-B',
          assigneeDepartmentIds: ['dept-C', 'dept-D'],
        });
        expect(
          await taskPolicy.check(deptContext, 'tasks:view', res, 'department'),
        ).toBe(false);
      });

      it('allows task when assignees array has a member in user department', async () => {
        const res = taskResource({
          assignees: [
            { id: 'user-2', fullName: 'User 2', departmentId: 'dept-A' },
          ],
        });
        expect(
          await taskPolicy.check(deptContext, 'tasks:view', res, 'department'),
        ).toBe(true);
      });

      it('allows task when creator is caller (fallback to caller department)', async () => {
        const res = taskResource({
          createdBy: deptContext.principal.id,
        });
        expect(
          await taskPolicy.check(deptContext, 'tasks:view', res, 'department'),
        ).toBe(true);
      });

      it('allows task when assignee is caller (fallback to caller department)', async () => {
        const res = taskResource({
          createdBy: 'other-user',
          assigneeIds: [deptContext.principal.id],
        });
        expect(
          await taskPolicy.check(deptContext, 'tasks:view', res, 'department'),
        ).toBe(true);
      });
    });
  });

  describe('pool scope object-level authorization', () => {
    const poolContext = makePoolContext({
      principalTeamId: 'pool-1',
      resolvedPoolIds: ['pool-1'],
      resolvedPoolMemberIds: ['user-pool-1', 'user-pool-2'],
    });

    it('TEST 1: Task owned by pool member (createdBy) -> ALLOW', async () => {
      const res = taskResource({ createdBy: 'user-pool-1' });
      const allowed = await taskPolicy.check(
        poolContext,
        'tasks:view',
        res,
        'pool',
      );
      expect(allowed).toBe(true);
    });

    it('TEST 1: Task assigned to pool member (assignedTo / assigneeIds) -> ALLOW', async () => {
      const res = taskResource({
        createdBy: 'unrelated-user',
        assignedTo: 'user-pool-2',
        assigneeIds: ['user-pool-2'],
      });
      const allowed = await taskPolicy.check(
        poolContext,
        'tasks:view',
        res,
        'pool',
      );
      expect(allowed).toBe(true);
    });

    it('TEST 1: Task with poolId matching user pool -> ALLOW', async () => {
      const res = taskResource({
        createdBy: 'unrelated-user',
        poolId: 'pool-1',
      });
      const allowed = await taskPolicy.check(
        poolContext,
        'tasks:view',
        res,
        'pool',
      );
      expect(allowed).toBe(true);
    });

    it('TEST 2: Task outside pool -> DENY', async () => {
      const res = taskResource({
        createdBy: 'user-outside',
        assignedTo: 'user-outside',
        assigneeIds: ['user-outside'],
        poolId: 'pool-outside',
      });
      const allowed = await taskPolicy.check(
        poolContext,
        'tasks:view',
        res,
        'pool',
      );
      expect(allowed).toBe(false);
    });

    it('TEST 3: Multiple allowed pool members -> ALLOW for any member', async () => {
      const multiMemberContext = makePoolContext({
        resolvedPoolMemberIds: ['user-pool-1', 'user-pool-2', 'user-pool-3'],
      });
      const res1 = taskResource({ createdBy: 'user-pool-1' });
      const res3 = taskResource({ createdBy: 'user-pool-3' });
      const resOutside = taskResource({ createdBy: 'user-other' });

      expect(
        await taskPolicy.check(multiMemberContext, 'tasks:view', res1, 'pool'),
      ).toBe(true);
      expect(
        await taskPolicy.check(multiMemberContext, 'tasks:view', res3, 'pool'),
      ).toBe(true);
      expect(
        await taskPolicy.check(multiMemberContext, 'tasks:view', resOutside, 'pool'),
      ).toBe(false);
    });

    it('TEST 4: Empty pool -> fail closed (DENY)', async () => {
      const emptyPoolContext = makePoolContext({
        principalTeamId: null,
        resolvedPoolIds: [],
        resolvedPoolMemberIds: [],
      });
      const res = taskResource({ createdBy: 'user-pool-1' });
      const allowed = await taskPolicy.check(
        emptyPoolContext,
        'tasks:view',
        res,
        'pool',
      );
      expect(allowed).toBe(false);
    });
  });

  describe('filtering predicates', () => {
    it('generates an own scope SQL filter referencing creator and assignee', async () => {
      const ctx = mockContext();
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'own');
      expect(filter.sql).toContain('t.created_by');
      expect(filter.sql).toContain('task_assignee');
      expect(filter.parameters).toContain(ctx.principal.id);
    });

    it('generates a participant scope SQL filter referencing task_assignee', async () => {
      const ctx = mockContext();
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'participant');
      expect(filter.sql).toContain('task_assignee');
      expect(filter.parameters).toContain(ctx.principal.id);
    });

    it('TEST 7: generates a team scope SQL filter referencing creator and assignee teams', async () => {
      const ctx = makeTeamContext({
        principalTeamId: 'team-A',
        resolvedTeamIds: ['team-A', 'team-B', 'team-C'],
      });
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'team');

      expect(filter.sql).toContain('u.team_id = ANY($1::uuid[])');
      expect(filter.sql).toContain('t.created_by');
      expect(filter.sql).toContain('task_assignee');
      expect(filter.parameters).toEqual([['team-A', 'team-B', 'team-C']]);
    });

    it('TEST 7 (empty teams): generates MATCH_NOTHING when user has no teamIds', async () => {
      const ctx = makeTeamContext({
        principalTeamId: null,
        resolvedTeamIds: [],
      });
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'team');
      expect(filter).toEqual(MATCH_NOTHING);
    });

    it('TEST 3: generates a department scope SQL filter referencing creator and assignee departments', async () => {
      const ctx = makeDepartmentContext({
        principalDepartmentId: 'dept-A',
        resolvedDepartmentId: 'dept-A',
      });
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'department');

      expect(filter.sql).toContain('u.department_id = $1');
      expect(filter.sql).toContain('t.created_by');
      expect(filter.sql).toContain('task_assignee');
      expect(filter.parameters).toEqual(['dept-A']);
    });

    it('TEST 8 (missing department in filter): generates MATCH_NOTHING when user has no departmentId', async () => {
      const ctx = makeDepartmentContext({
        principalDepartmentId: null,
        resolvedDepartmentId: null,
      });
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'department');
      expect(filter).toEqual(MATCH_NOTHING);
    });

    it('TEST 5: generates a pool scope SQL filter when pool members and pool IDs are present', async () => {
      const ctx = makePoolContext({
        resolvedPoolIds: ['pool-1'],
        resolvedPoolMemberIds: ['user-pool-1', 'user-pool-2'],
      });
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'pool');

      expect(filter.sql).toContain('t.created_by = ANY($1::uuid[])');
      expect(filter.sql).toContain('task_assignee');
      expect(filter.sql).toContain('u.team_id = ANY($2::uuid[])');
      expect(filter.parameters).toEqual([['user-pool-1', 'user-pool-2'], ['pool-1']]);
    });

    it('TEST 5: generates a pool scope SQL filter when only pool members are present', async () => {
      const ctx = makePoolContext({
        resolvedPoolIds: [],
        resolvedPoolMemberIds: ['user-pool-1', 'user-pool-2'],
      });
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'pool');

      expect(filter.sql).toContain('t.created_by = ANY($1::uuid[])');
      expect(filter.sql).toContain('task_assignee');
      expect(filter.parameters).toEqual([['user-pool-1', 'user-pool-2']]);
    });

    it('TEST 5: generates a pool scope SQL filter when only pool IDs are present', async () => {
      const ctx = makePoolContext({
        resolvedPoolIds: ['pool-1'],
        resolvedPoolMemberIds: [],
      });
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'pool');

      expect(filter.sql).toContain('u.team_id = ANY($1::uuid[])');
      expect(filter.sql).toContain('t.created_by');
      expect(filter.sql).toContain('task_assignee');
      expect(filter.parameters).toEqual([['pool-1']]);
    });

    it('TEST 4: generates MATCH_NOTHING when pool is empty (never TRUE)', async () => {
      const ctx = makePoolContext({
        principalTeamId: null,
        resolvedPoolIds: [],
        resolvedPoolMemberIds: [],
      });
      const filter = await taskPolicy.filter(ctx, 'tasks:view', 'pool');
      expect(filter).toEqual(MATCH_NOTHING);
    });
  });

  describe('Engine integration (authorize) — Object-level protection across actions', () => {
    const ctx = makeTeamContext({
      principalTeamId: 'team-A',
      resolvedTeamIds: ['team-A', 'team-B', 'team-C'],
    });

    beforeEach(() => {
      __resetConstraints();
      __resetResourcePolicies();
      registerProtectedConstraints();
      registerTasksPolicies();

      configureAuthz({
        scope: {
          subordinateIds: async () => new Set(),
          teamIds: async () => new Set(['team-A', 'team-B', 'team-C']),
          poolIds: async () => new Set(),
          poolMemberIds: async () => new Set(),
          departmentId: async () => 'dept-1',
        },
        policies: {
          resolveSet: async () => ({
            policies: {
              'tasks:view': {
                action: 'tasks:view',
                allowed: true,
                scope: 'team',
                source: 'position',
              },
              'tasks:update': {
                action: 'tasks:update',
                allowed: true,
                scope: 'team',
                source: 'position',
              },
              'tasks:manage-dependencies': {
                action: 'tasks:manage-dependencies',
                allowed: true,
                scope: 'team',
                source: 'position',
              },
            },
            cacheDeadline: new Date(Date.now() + 60_000),
            resolvedAt: new Date(),
          }),
        },
        audit: {
          sensitiveUse: () => {},
          superAdminBypass: () => {},
          segregationBlocked: () => {},
          defect: () => {},
        },
        now: () => new Date(),
      });
    });

    it('TEST 8: Direct GET by ID cannot bypass Team scope (tasks:view)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(ctx, 'tasks:view', taskResource({ teamId: 'team-B' })),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(ctx, 'tasks:view', taskResource({ teamId: 'team-X' })),
      ).rejects.toThrow(AuthorizationError);
    });

    it('TEST 9: Update cannot modify a task outside Team scope (tasks:update)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(ctx, 'tasks:update', taskResource({ teamId: 'team-C' })),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(ctx, 'tasks:update', taskResource({ teamId: 'team-X' })),
      ).rejects.toThrow(AuthorizationError);
    });

    it('TEST 10: Delete/manage cannot operate on a task outside Team scope (tasks:manage-dependencies)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(
          ctx,
          'tasks:manage-dependencies',
          taskResource({ teamId: 'team-A' }),
        ),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(
          ctx,
          'tasks:manage-dependencies',
          taskResource({ teamId: 'team-X' }),
        ),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('Department scope integration with authorize()', () => {
    const deptCtx = makeDepartmentContext({
      principalDepartmentId: 'dept-A',
      resolvedDepartmentId: 'dept-A',
    });

    beforeEach(() => {
      __resetConstraints();
      __resetResourcePolicies();
      registerProtectedConstraints();
      registerTasksPolicies();

      configureAuthz({
        scope: {
          subordinateIds: async () => new Set(),
          teamIds: async () => new Set(),
          poolIds: async () => new Set(),
          poolMemberIds: async () => new Set(),
          departmentId: async () => 'dept-A',
        },
        policies: {
          resolveSet: async () => ({
            policies: {
              'tasks:view': {
                action: 'tasks:view',
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
              'tasks:manage-dependencies': {
                action: 'tasks:manage-dependencies',
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
            },
            cacheDeadline: new Date(Date.now() + 60_000),
            resolvedAt: new Date(),
          }),
        },
        audit: {
          sensitiveUse: () => {},
          superAdminBypass: () => {},
          segregationBlocked: () => {},
          defect: () => {},
        },
        now: () => new Date(),
      });
    });

    it('TEST 4: Direct GET by ID cannot bypass Department scope (tasks:view)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(deptCtx, 'tasks:view', taskResource({ departmentId: 'dept-A' })),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(deptCtx, 'tasks:view', taskResource({ departmentId: 'dept-B' })),
      ).rejects.toThrow(AuthorizationError);
    });

    it('TEST 5: Update cannot modify a task outside Department scope (tasks:update)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(deptCtx, 'tasks:update', taskResource({ departmentId: 'dept-A' })),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(deptCtx, 'tasks:update', taskResource({ departmentId: 'dept-B' })),
      ).rejects.toThrow(AuthorizationError);
    });

    it('TEST 6: Delete/manage cannot operate on a task outside Department scope (tasks:manage-dependencies)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(
          deptCtx,
          'tasks:manage-dependencies',
          taskResource({ departmentId: 'dept-A' }),
        ),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(
          deptCtx,
          'tasks:manage-dependencies',
          taskResource({ departmentId: 'dept-B' }),
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    it('TEST 7: Assignment outside department is DENIED (tasks:assign)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(deptCtx, 'tasks:assign', taskResource({ departmentId: 'dept-A' })),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(deptCtx, 'tasks:assign', taskResource({ departmentId: 'dept-B' })),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('Pool scope integration with authorize()', () => {
    const poolCtx = makePoolContext({
      principalTeamId: 'pool-1',
      resolvedPoolIds: ['pool-1'],
      resolvedPoolMemberIds: ['user-pool-1', 'user-pool-2'],
    });

    beforeEach(() => {
      __resetConstraints();
      __resetResourcePolicies();
      registerProtectedConstraints();
      registerTasksPolicies();

      configureAuthz({
        scope: {
          subordinateIds: async () => new Set(),
          teamIds: async () => new Set(['pool-1']),
          poolIds: async () => new Set(['pool-1']),
          poolMemberIds: async () => new Set(['user-pool-1', 'user-pool-2']),
          departmentId: async () => 'dept-sales',
        },
        policies: {
          resolveSet: async () => ({
            policies: {
              'tasks:view': {
                action: 'tasks:view',
                allowed: true,
                scope: 'pool',
                source: 'position',
              },
              'tasks:update': {
                action: 'tasks:update',
                allowed: true,
                scope: 'pool',
                source: 'position',
              },
              'tasks:manage-dependencies': {
                action: 'tasks:manage-dependencies',
                allowed: true,
                scope: 'pool',
                source: 'position',
              },
              'tasks:assign': {
                action: 'tasks:assign',
                allowed: true,
                scope: 'pool',
                source: 'position',
              },
            },
            cacheDeadline: new Date(Date.now() + 60_000),
            resolvedAt: new Date(),
          }),
        },
        audit: {
          sensitiveUse: () => {},
          superAdminBypass: () => {},
          segregationBlocked: () => {},
          defect: () => {},
        },
        now: () => new Date(),
      });
    });

    it('TEST 6: Direct GET by ID cannot bypass Pool scope (tasks:view)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(poolCtx, 'tasks:view', taskResource({ createdBy: 'user-pool-1' })),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(
          poolCtx,
          'tasks:view',
          taskResource({ createdBy: 'user-outside', poolId: 'pool-other' }),
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    it('TEST 7: Update cannot modify a task outside Pool scope (tasks:update)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(poolCtx, 'tasks:update', taskResource({ createdBy: 'user-pool-2' })),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(
          poolCtx,
          'tasks:update',
          taskResource({ createdBy: 'user-outside', poolId: 'pool-other' }),
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    it('TEST 8: Delete/manage cannot operate on a task outside Pool scope (tasks:manage-dependencies)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(
          poolCtx,
          'tasks:manage-dependencies',
          taskResource({ poolId: 'pool-1' }),
        ),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(
          poolCtx,
          'tasks:manage-dependencies',
          taskResource({ createdBy: 'user-outside', poolId: 'pool-other' }),
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    it('TEST 9: Assignment outside pool is DENIED (tasks:assign)', async () => {
      // In-scope task succeeds
      await expect(
        authorize(poolCtx, 'tasks:assign', taskResource({ createdBy: 'user-pool-1' })),
      ).resolves.toBeUndefined();

      // Out-of-scope task throws AuthorizationError
      await expect(
        authorize(
          poolCtx,
          'tasks:assign',
          taskResource({ createdBy: 'user-outside', poolId: 'pool-other' }),
        ),
      ).rejects.toThrow(AuthorizationError);
    });
  });
});

