import { beforeEach, describe, expect, it } from 'vitest';
import {
  authorize,
  configureAuthz,
  registerProtectedConstraints,
  __resetConstraints,
  __resetResourcePolicies,
  type AuthzContext,
} from '@tapcrm/authz';
import type { PermissionSet, Principal } from '@tapcrm/contracts';
import { registerProjectPolicies } from './policy.js';

const organizationId = '00000000-0000-0000-0000-000000000001';
const creator = 'user-creator';
const assignee = 'user-assignee';
const stranger = 'user-stranger';

function principal(id: string): Principal {
  return {
    id, organizationId, accountType: 'employee', sessionVersion: 1,
    departmentId: 'dept-1', teamId: 'team-1', positionId: 'position-1', reportsTo: null, organizationalLevel: 50,
  };
}

function ctx(id: string): AuthzContext {
  return { principal: principal(id), organizationId, requestId: 'req-project-1', memo: new Map() };
}

describe('project resource policy', () => {
  beforeEach(() => {
    __resetResourcePolicies();
    __resetConstraints();
    registerProtectedConstraints();
    registerProjectPolicies();

    configureAuthz({
      scope: {
        subordinateIds: async () => new Set(),
        teamIds: async () => new Set(['team-1']),
        poolIds: async () => new Set(),
        poolMemberIds: async () => new Set(),
        departmentId: async () => 'dept-1',
      },
      policies: {
        resolveSet: async (): Promise<PermissionSet> => ({
          policies: { 'projects:view': { action: 'projects:view', allowed: true, scope: 'own', source: 'position' } },
          cacheDeadline: new Date(Date.now() + 60_000),
          resolvedAt: new Date(),
        }),
      },
      audit: {
        sensitiveUse: () => undefined,
        superAdminBypass: () => undefined,
        segregationBlocked: () => undefined,
        defect: () => undefined,
      },
      now: () => new Date(),
    });
  });

  it('the creator may always access their project', async () => {
    await expect(
      authorize(ctx(creator), 'projects:view', { type: 'project', id: 'p1', organizationId, createdBy: creator, assigneeIds: [] }),
    ).resolves.toBeUndefined();
  });

  it('an assignee may access the project', async () => {
    await expect(
      authorize(ctx(assignee), 'projects:view', { type: 'project', id: 'p1', organizationId, createdBy: creator, assigneeIds: [assignee] }),
    ).resolves.toBeUndefined();
  });

  it('an uninvolved employee is refused', async () => {
    await expect(
      authorize(ctx(stranger), 'projects:view', { type: 'project', id: 'p1', organizationId, createdBy: creator, assigneeIds: [assignee] }),
    ).rejects.toThrow();
  });

  it('never crosses a tenant boundary', async () => {
    await expect(
      authorize(ctx(creator), 'projects:view', { type: 'project', id: 'p1', organizationId: 'other-org', createdBy: creator, assigneeIds: [] }),
    ).rejects.toThrow();
  });
});
