import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationContext, ScopeResolverPort } from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';
import { taskPolicy } from './policy.js';

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
  });
});
