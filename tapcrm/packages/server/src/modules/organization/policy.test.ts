import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationContext } from '@tapcrm/authz';
import { positionPolicy } from './policy.js';

function context(): PolicyEvaluationContext {
  return {
    organizationId: 'organization-1',
    requestId: 'request-1',
    memo: new Map(),
    principal: {
      id: 'hr-user',
      organizationId: 'organization-1',
      accountType: 'employee',
      departmentId: 'hr-department',
      positionId: 'hr-position',
      teamId: null,
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'hr-department',
      teamIds: async () => new Set<string>(),
      poolIds: async () => new Set<string>(),
      subordinateIds: async () => new Set<string>(),
      poolMemberIds: async () => new Set<string>(),
    },
  };
}

const position = {
  type: 'position',
  id: 'sales-position',
  organizationId: 'organization-1',
  departmentId: 'sales-department',
};

describe('position policy authorization', () => {
  it('allows same-organization policy preview across departments', async () => {
    await expect(
      positionPolicy.check(context(), 'org:view-policies', position, 'department'),
    ).resolves.toBe(true);

    await expect(
      positionPolicy.filter(context(), 'org:view-policies', 'department'),
    ).resolves.toEqual({
      sql: 'position.organization_id = $1',
      parameters: ['organization-1'],
    });
  });

  it('keeps position management department-scoped and tenant-safe', async () => {
    await expect(
      positionPolicy.check(context(), 'org:manage-positions', position, 'department'),
    ).resolves.toBe(false);
    await expect(
      positionPolicy.check(context(), 'org:view-policies', {
        ...position,
        organizationId: 'organization-2',
      }, 'department'),
    ).resolves.toBe(false);
  });
});
