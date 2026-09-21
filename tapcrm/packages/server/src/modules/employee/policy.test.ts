import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationContext, ScopeResolverPort } from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';
import { userPolicy } from './policy.js';

const organizationId = 'organization-1';

function context(): PolicyEvaluationContext {
  return {
    organizationId,
    requestId: 'request-1',
    memo: new Map(),
    principal: {
      id: 'employee-1',
      organizationId,
      accountType: 'employee',
      departmentId: 'department-1',
      teamId: 'team-1',
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'department-1',
      teamIds: async () => new Set(['team-1']),
      poolIds: async () => new Set(['team-1']),
      subordinateIds: async () => new Set<string>(),
      poolMemberIds: async () => new Set<string>(),
    },
  };
}

function resource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'user',
    id: 'employee-2',
    organizationId,
    departmentId: 'department-1',
    teamId: 'team-2',
    ...overrides,
  };
}

function withScopes(
  overrides: Partial<{
    department: ScopeResolverPort['departmentId'];
    teams: ScopeResolverPort['teamIds'];
    pools: ScopeResolverPort['poolIds'];
  }> = {},
) {
  const ctx = context();
  const scopes = {
    department: async () => 'department-1',
    teams: async () => new Set(['team-1', 'team-2', 'team-3']),
    pools: async () => new Set(['team-1']),
    ...overrides,
  };
  return {
    ...ctx,
    scope: {
      departmentId: scopes.department,
      teamIds: scopes.teams,
      poolIds: scopes.pools,
      subordinateIds: async () => new Set<string>(),
      poolMemberIds: async () => new Set<string>(),
    },
  };
}

describe('user authorization scope consistency', () => {
  it.each<Scope>(['own', 'department', 'team', 'pool', 'all-people'])(
    'uses the same tenant boundary for %s object checks',
    async (scope) => {
      await expect(
        userPolicy.check(
          withScopes(),
          'users:manage',
          resource({ organizationId: 'organization-2' }),
          scope,
        ),
      ).resolves.toBe(false);
    },
  );

  it('allows descendant team records through the same resolved team set used by filtering', async () => {
    const ctx = withScopes();
    await expect(
      userPolicy.check(ctx, 'users:manage', resource({ teamId: 'team-3' }), 'team'),
    ).resolves.toBe(true);
    const teamPredicate = await userPolicy.filter(ctx, 'users:manage', 'team');
    expect(teamPredicate.sql).toContain('u.team_id = ANY');
    expect(teamPredicate.parameters).toEqual([['team-1', 'team-2', 'team-3']]);
  });

  it('uses the resolved pool set rather than exact team equality', async () => {
    const ctx = withScopes({ pools: async () => new Set(['team-2']) });
    await expect(
      userPolicy.check(ctx, 'users:manage', resource({ teamId: 'team-2' }), 'pool'),
    ).resolves.toBe(true);
    await expect(
      userPolicy.check(ctx, 'users:manage', resource({ teamId: 'team-3' }), 'pool'),
    ).resolves.toBe(false);
  });

  it('preserves own, department, and all-people semantics', async () => {
    const ctx = withScopes();
    await expect(
      userPolicy.check(ctx, 'users:manage', resource({ id: 'employee-1' }), 'own'),
    ).resolves.toBe(true);
    await expect(
      userPolicy.check(
        ctx,
        'users:manage',
        resource({ departmentId: 'department-1' }),
        'department',
      ),
    ).resolves.toBe(true);
    await expect(
      userPolicy.check(
        ctx,
        'users:manage',
        resource({ departmentId: 'other' }),
        'department',
      ),
    ).resolves.toBe(false);
    await expect(
      userPolicy.check(
        ctx,
        'users:manage',
        resource({ departmentId: 'other' }),
        'all-people',
      ),
    ).resolves.toBe(true);
  });
});
