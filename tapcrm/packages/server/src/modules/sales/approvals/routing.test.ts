import { describe, expect, it } from 'vitest';
import { covers, findLowestEligibleApprover, type Candidate } from './routing.js';
import type { ActorAuthority } from './types.js';

const agent: Candidate = {
  userId: 'agent',
  reportsTo: 'supervisor',
  authority: { maxValueMinor: 500_000_00n, maxDiscountBps: 1000, minAdvanceBps: null, allowsCustomTerms: false },
};
const supervisor: Candidate = {
  userId: 'supervisor',
  reportsTo: 'lead',
  authority: { maxValueMinor: 2_000_000_00n, maxDiscountBps: 1500, minAdvanceBps: null, allowsCustomTerms: false },
};
const lead: Candidate = {
  userId: 'lead',
  reportsTo: 'hod',
  authority: { maxValueMinor: 10_000_000_00n, maxDiscountBps: 2500, minAdvanceBps: null, allowsCustomTerms: true },
};
const hod: Candidate = {
  userId: 'hod',
  reportsTo: null,
  authority: { maxValueMinor: null, maxDiscountBps: null, minAdvanceBps: null, allowsCustomTerms: true },
};
const CHAIN = new Map([agent, supervisor, lead, hod].map((c) => [c.userId, c]));

const resolve = async (id: string): Promise<Candidate | null> => CHAIN.get(id) ?? null;

const unlimited: ActorAuthority = {
  maxValueMinor: null, maxDiscountBps: null, minAdvanceBps: null, allowsCustomTerms: true,
};

describe('covers', () => {
  it('null limits are unlimited', () => {
    expect(covers(unlimited, { totalMinor: 10n ** 18n, discountBps: 9999, advanceBps: 0, requiresCustomTerms: true })).toBe(true);
  });
  it('refuses a value above the limit', () => {
    expect(covers(agent.authority, { totalMinor: 600_000_00n, discountBps: 0, advanceBps: 0, requiresCustomTerms: false })).toBe(false);
  });
  it('refuses a discount above the limit', () => {
    expect(covers(agent.authority, { totalMinor: 100n, discountBps: 2500, advanceBps: 0, requiresCustomTerms: false })).toBe(false);
  });
  it('refuses custom terms when actor cannot grant', () => {
    expect(covers(agent.authority, { totalMinor: 100n, discountBps: 0, advanceBps: 0, requiresCustomTerms: true })).toBe(false);
  });
});

describe('findLowestEligibleApprover', () => {
  it('skips the requester themselves (A-1)', async () => {
    const result = await findLowestEligibleApprover('agent', {
      totalMinor: 100_000n, discountBps: 0, advanceBps: 0, requiresCustomTerms: false,
    }, resolve);
    // Even though agent trivially covers, the walk starts at supervisor.
    expect(result?.userId).toBe('supervisor');
  });

  it('returns the first eligible manager', async () => {
    const result = await findLowestEligibleApprover('agent', {
      totalMinor: 1_000_000_00n,                            // > agent limit, < supervisor limit
      discountBps: 1200,                                     // > agent, < supervisor
      advanceBps: 0,
      requiresCustomTerms: false,
    }, resolve);
    expect(result?.userId).toBe('supervisor');
  });

  it('walks further when supervisor cannot cover one dimension', async () => {
    const result = await findLowestEligibleApprover('agent', {
      totalMinor: 3_000_000_00n,                            // > supervisor
      discountBps: 1200,
      advanceBps: 0,
      requiresCustomTerms: false,
    }, resolve);
    expect(result?.userId).toBe('lead');
  });

  it('walks to HOD when custom terms demanded above the lead', async () => {
    const result = await findLowestEligibleApprover('agent', {
      totalMinor: 100_000_00n,
      discountBps: 500,
      advanceBps: 0,
      requiresCustomTerms: true,
    }, resolve);
    expect(result?.userId).toBe('lead');                   // lead can grant customTerms
  });

  it('returns null when the chain exhausts without a cover', async () => {
    const supervisorChain = new Map([
      [agent.userId, { ...agent, reportsTo: 'supervisor' }],
      [supervisor.userId, { ...supervisor, reportsTo: null }],
    ]);
    const result = await findLowestEligibleApprover('agent', {
      totalMinor: 10_000_000_00n,                           // beyond supervisor
      discountBps: 0,
      advanceBps: 0,
      requiresCustomTerms: false,
    }, async (id) => supervisorChain.get(id) ?? null);
    expect(result).toBeNull();
  });

  it('is cycle-safe', async () => {
    const cycle = new Map([
      ['a', { userId: 'a', reportsTo: 'b', authority: agent.authority }],
      ['b', { userId: 'b', reportsTo: 'a', authority: agent.authority }],
    ]);
    const result = await findLowestEligibleApprover('a', {
      totalMinor: 10_000_000_00n,
      discountBps: 0,
      advanceBps: 0,
      requiresCustomTerms: false,
    }, async (id) => cycle.get(id) ?? null);
    expect(result).toBeNull();
  });
});
