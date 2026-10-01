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
import { registerChatPolicies } from './policy.js';

const organizationId = '00000000-0000-0000-0000-000000000001';
const me = 'user-me';
const other = 'user-other';
const stranger = 'user-stranger';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: me,
    organizationId,
    accountType: 'employee',
    sessionVersion: 1,
    departmentId: 'dept-1',
    teamId: 'team-1',
    positionId: 'position-1',
    reportsTo: null,
    organizationalLevel: 50,
    ...overrides,
  } as Principal;
}

function ctx(overrides: Partial<Principal> = {}): AuthzContext {
  return { principal: principal(overrides), organizationId, requestId: 'req-chat-1', memo: new Map() };
}

describe('chat resource policy', () => {
  beforeEach(() => {
    __resetResourcePolicies();
    __resetConstraints();
    registerProtectedConstraints();
    registerChatPolicies();

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
          policies: { 'chat:view': { action: 'chat:view', allowed: true, scope: 'department', source: 'position' } },
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

  it('CH-1: membership decides access, regardless of the granted scope value', async () => {
    // The matrix grants 'department' scope, but a chat conversation has no
    // "my department's conversations" concept — being a MEMBER is what matters.
    await expect(
      authorize(ctx(), 'chat:view', { type: 'chatConversation', id: 'c1', organizationId, memberIds: [me, other] }),
    ).resolves.toBeUndefined();
  });

  it('a non-member is refused even though their position holds chat:view', async () => {
    await expect(
      authorize(ctx(), 'chat:view', { type: 'chatConversation', id: 'c1', organizationId, memberIds: [other, stranger] }),
    ).rejects.toThrow();
  });

  it('never crosses a tenant boundary', async () => {
    await expect(
      authorize(ctx(), 'chat:view', { type: 'chatConversation', id: 'c1', organizationId: 'other-org', memberIds: [me] }),
    ).rejects.toThrow();
  });
});
