import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationContext } from '@tapcrm/authz';
import { canViewInternalHandoverState, handoverPolicy, isHandedOverAway } from './policy.js';

const baseContext = { organizationId: 'org-a', principal: { id: 'user-a' }, scope: { poolIds: async () => new Set<string>(), teamIds: async () => new Set<string>(), departmentId: async () => null } };
const context = baseContext as unknown as PolicyEvaluationContext;
const resource = { type: 'handover', id: 'handover-a', organizationId: 'org-a', leadId: 'lead-a', fromUserId: 'user-a', toUserId: 'user-b', handoverMode: 'direct' as const, status: 'pending', disposition: null, ownerId: 'user-a', currentHolderId: 'user-a', salesTeamId: null, salesPoolId: null, departmentId: null };

describe('lead handover policy', () => {
  it('allows only the offered target to receive', async () => {
    expect(await handoverPolicy.check({ ...baseContext, principal: { id: 'user-b' } } as unknown as PolicyEvaluationContext, 'handovers:receive', resource, 'own')).toBe(true);
    expect(await handoverPolicy.check(context, 'handovers:receive', resource, 'own')).toBe(false);
  });

  it('allows an eligible policy principal to claim an unassigned team queue item', async () => {
    const queued = { ...resource, toUserId: null, handoverMode: 'team_queue' as const };
    expect(await handoverPolicy.check({ ...baseContext, principal: { id: 'user-c' } } as unknown as PolicyEvaluationContext, 'handovers:receive', queued, 'own')).toBe(true);
  });

  it('keeps initiation with the current originator', async () => {
    expect(await handoverPolicy.check(context, 'handovers:initiate', resource, 'own')).toBe(true);
    expect(await handoverPolicy.check({ ...baseContext, principal: { id: 'user-c' } } as unknown as PolicyEvaluationContext, 'handovers:initiate', resource, 'own')).toBe(false);
  });

  it('hides finalized handover state from the original owner', async () => {
    expect(await handoverPolicy.check(context, 'handovers:view', { ...resource, status: 'accepted' }, 'own')).toBe(false);
    expect(await handoverPolicy.check({ ...baseContext, principal: { id: 'user-b' } } as unknown as PolicyEvaluationContext, 'handovers:view', { ...resource, status: 'accepted' }, 'own')).toBe(true);
  });

  it('preserves Lead visibility while hiding internal state from the original owner', () => {
    expect(canViewInternalHandoverState('user-a', false, 'user-a', 'user-b')).toBe(false);
    expect(canViewInternalHandoverState('user-b', false, 'user-a', 'user-b')).toBe(true);
    expect(canViewInternalHandoverState('user-a', false, 'user-a', 'user-a')).toBe(true);
    expect(canViewInternalHandoverState('user-a', false, 'user-a', 'user-a', true)).toBe(false);
  });
});

describe('a lead after an accepted handover', () => {
  it('is out of the hands of the agent who handed it over while the receiver holds it', () => {
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: 'supervisor' }, 'agent')).toBe(true);
  });
  it('is worked by the receiver, and untouched for managers looking at it', () => {
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: 'supervisor' }, 'supervisor')).toBe(false);
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: 'supervisor' }, 'sales-head')).toBe(false);
  });
  it('is the owner’s again once a manager reassigns it back', () => {
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: 'agent' }, 'agent')).toBe(false);
    expect(isHandedOverAway({ ownerId: 'agent', currentHolderId: null }, 'agent')).toBe(false);
  });
});
