import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationContext } from '@tapcrm/authz';
import { territoryPolicy } from './policy.js';

const org = '00000000-0000-0000-0000-000000000001';
const context = (departmentId: string | null = 'dept-sales', teamIds = ['team-a']): PolicyEvaluationContext => ({
  organizationId: org, requestId: 'req', memo: new Map(),
  principal: { id: 'user', organizationId: org, accountType: 'employee', departmentId, teamId: teamIds[0] ?? null } as PolicyEvaluationContext['principal'],
  scope: { departmentId: async () => departmentId, teamIds: async () => new Set(teamIds), poolIds: async () => new Set(), poolMemberIds: async () => new Set(), subordinateIds: async () => new Set() },
});

describe('territory policy', () => {
  it('enforces department and team scope without role checks', async () => {
    const ctx = context();
    expect(await territoryPolicy.check(ctx, 'territories:view', { type: 'territory', id: 'a', organizationId: org, salesTeamId: 'team-a', departmentId: 'dept-sales' }, 'department')).toBe(true);
    expect(await territoryPolicy.check(ctx, 'territories:view', { type: 'territory', id: 'b', organizationId: org, salesTeamId: 'team-b', departmentId: 'dept-sales' }, 'team')).toBe(false);
    expect(await territoryPolicy.check(ctx, 'territories:view', { type: 'territory', id: 'x', organizationId: 'other', salesTeamId: 'team-a', departmentId: 'dept-sales' }, 'team')).toBe(false);
  });
});
