import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationContext } from '@tapcrm/authz';
import { handoverPolicy } from './handover-policy.js';

const baseContext = { organizationId: 'org-a', principal: { id: 'user-a' }, scope: { poolIds: async () => new Set<string>(), teamIds: async () => new Set<string>(), departmentId: async () => null } };
const context = baseContext as unknown as PolicyEvaluationContext;
const resource = { type: 'handover', id: 'handover-a', organizationId: 'org-a', leadId: 'lead-a', fromUserId: 'user-a', toUserId: 'user-b', status: 'pending', disposition: null, ownerId: 'user-a', currentHolderId: 'user-a', salesTeamId: null, salesPoolId: null, departmentId: null };

describe('lead handover policy', () => {
  it('allows only the offered target to receive', async () => {
    expect(await handoverPolicy.check({ ...baseContext, principal: { id: 'user-b' } } as unknown as PolicyEvaluationContext, 'handovers:receive', resource, 'own')).toBe(true);
    expect(await handoverPolicy.check(context, 'handovers:receive', resource, 'own')).toBe(false);
  });

  it('keeps initiation with the current originator', async () => {
    expect(await handoverPolicy.check(context, 'handovers:initiate', resource, 'own')).toBe(true);
    expect(await handoverPolicy.check({ ...baseContext, principal: { id: 'user-c' } } as unknown as PolicyEvaluationContext, 'handovers:initiate', resource, 'own')).toBe(false);
  });
});
