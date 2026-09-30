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
import { registerClientPolicies } from './policy.js';

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
  return { principal: principal(id), organizationId, requestId: 'req-client-1', memo: new Map() };
}

describe('client resource policy', () => {
  beforeEach(() => {
    __resetResourcePolicies();
    __resetConstraints();
    registerProtectedConstraints();
    registerClientPolicies();

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
          policies: { 'clients:view': { action: 'clients:view', allowed: true, scope: 'department', source: 'position' } },
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

  it('the creator may always access their client, regardless of the matrix scope word', async () => {
    await expect(
      authorize(ctx(creator), 'clients:view', { type: 'client', id: 'c1', organizationId, createdBy: creator, projectAssigneeIds: [] }),
    ).resolves.toBeUndefined();
  });

  it('someone assigned to a project for this client may access it too', async () => {
    await expect(
      authorize(ctx(assignee), 'clients:view', { type: 'client', id: 'c1', organizationId, createdBy: creator, projectAssigneeIds: [assignee] }),
    ).resolves.toBeUndefined();
  });

  it('an uninvolved employee is refused even though their position holds clients:view', async () => {
    await expect(
      authorize(ctx(stranger), 'clients:view', { type: 'client', id: 'c1', organizationId, createdBy: creator, projectAssigneeIds: [assignee] }),
    ).rejects.toThrow();
  });

  it('never crosses a tenant boundary', async () => {
    await expect(
      authorize(ctx(creator), 'clients:view', { type: 'client', id: 'c1', organizationId: 'other-org', createdBy: creator, projectAssigneeIds: [] }),
    ).rejects.toThrow();
  });
});
