import { beforeEach, describe, expect, it } from 'vitest';
import type { Action, PermissionSet, Principal, Scope } from '@tapcrm/contracts';
import { configureAuthz, type PolicyEvaluationContext } from '@tapcrm/authz';
import { assertDelegationAllowed, type DelegationTarget } from './delegation.js';

/**
 * The delegation guard — PRD §4.6.
 *
 * These are the four constraints that stand between "holds access:delegate" and
 * "may write this particular grant". The near-misses matter more than the happy
 * path: equal seniority, one scope step too wide, a target just outside the
 * boundary. Each must fail, and fail naming the constraint.
 */

const ORG = '11111111-1111-7111-8111-111111111111';
const ACTOR = '22222222-2222-7222-8222-222222222222';
const TARGET = '33333333-3333-7333-8333-333333333333';

const held: Partial<Record<Action, { allowed: boolean; scope: Scope; fields?: string[] }>> = {};

beforeEach(() => {
  for (const key of Object.keys(held)) delete held[key as Action];
  configureAuthz({
    scope: {
      subordinateIds: async () => new Set([TARGET]),
      teamIds: async () => new Set(['team-1']),
      poolIds: async () => new Set(['team-1']),
      poolMemberIds: async () => new Set([TARGET]),
      departmentId: async () => 'dept-1',
    },
    policies: {
      resolveSet: async (): Promise<PermissionSet> => ({
        policies: Object.fromEntries(
          Object.entries(held).map(([action, p]) => [
            action,
            { action: action as Action, ...p, source: 'position' as const },
          ]),
        ),
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

function actor(overrides: Partial<Principal> = {}): Principal {
  return {
    id: ACTOR,
    organizationId: ORG,
    accountType: 'employee',
    sessionVersion: 1,
    positionId: 'pos-1',
    departmentId: 'dept-1',
    teamId: 'team-1',
    reportsTo: null,
    organizationalLevel: 50,
    ...overrides,
  } as Principal;
}

function context(principal: Principal = actor()): PolicyEvaluationContext {
  return {
    principal,
    organizationId: ORG,
    requestId: 'req-1',
    memo: new Map(),
    scope: {
      subordinateIds: async () => new Set([TARGET]),
      teamIds: async () => new Set(['team-1']),
      poolIds: async () => new Set(['team-1']),
      poolMemberIds: async () => new Set([TARGET]),
      departmentId: async () => 'dept-1',
    },
  };
}

function target(overrides: Partial<DelegationTarget> = {}): DelegationTarget {
  return {
    id: TARGET,
    organizationId: ORG,
    departmentId: 'dept-1',
    teamId: 'team-1',
    organizationalLevel: 20,
    ...overrides,
  };
}

const grant = (overrides: Record<string, unknown> = {}) => ({
  action: 'leads:view' as Action,
  allowed: true,
  scope: 'team' as Scope,
  fields: null,
  ...overrides,
});

describe('root of trust (PRD §4.6)', () => {
  it('refuses access:delegate from a non-Super-Admin however much they hold', async () => {
    held['access:delegate'] = { allowed: true, scope: 'all-people' };
    await expect(
      assertDelegationAllowed(context(), grant({ action: 'access:delegate', scope: 'own' }), target()),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_ROOT_OF_TRUST' });
  });

  it('refuses users:manage from a non-Super-Admin', async () => {
    held['access:delegate'] = { allowed: true, scope: 'all-people' };
    held['users:manage'] = { allowed: true, scope: 'all-people' };
    await expect(
      assertDelegationAllowed(context(), grant({ action: 'users:manage', scope: 'own' }), target()),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_ROOT_OF_TRUST' });
  });

  it('allows Super Admin to grant a root-of-trust action', async () => {
    const ctx = context(actor({ accountType: 'super-admin' }));
    await expect(
      assertDelegationAllowed(ctx, grant({ action: 'access:delegate', scope: 'own' }), target()),
    ).resolves.toBeUndefined();
  });
});

describe('delegability (registry grantPolicy)', () => {
  /**
   * Distinct from root of trust. 18 actions are `superAdminOnly`; 65 more are
   * simply not delegable — the registry forbids delegating any sensitive
   * action (migration 0002: `CHECK (NOT delegation_allowed OR NOT sensitive)`).
   * `payroll:view` is one: a delegate cannot hand out sight of payslips.
   */
  it('refuses a non-delegable action even when the actor holds it widely', async () => {
    held['access:delegate'] = { allowed: true, scope: 'all-people' };
    held['payroll:view'] = { allowed: true, scope: 'all-people' };
    await expect(
      assertDelegationAllowed(context(), grant({ action: 'payroll:view', scope: 'own' }), target()),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_NOT_DELEGABLE' });
  });

  it('lets Super Admin grant it, being the root authority rather than a delegate', async () => {
    const ctx = context(actor({ accountType: 'super-admin' }));
    await expect(
      assertDelegationAllowed(ctx, grant({ action: 'payroll:view', scope: 'own' }), target()),
    ).resolves.toBeUndefined();
  });
});

describe('ceiling (PRD §4.6)', () => {
  beforeEach(() => {
    held['access:delegate'] = { allowed: true, scope: 'department' };
  });

  it('refuses an action the actor does not hold at all', async () => {
    // A delegable action, so the ceiling is what refuses it rather than the
    // delegability check above.
    await expect(
      assertDelegationAllowed(context(), grant({ action: 'attendance:view' }), target()),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_CEILING_EXCEEDED' });
  });

  it('refuses an action the actor holds but is denied', async () => {
    held['leads:view'] = { allowed: false, scope: 'department' };
    await expect(
      assertDelegationAllowed(context(), grant(), target()),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_CEILING_EXCEEDED' });
  });

  it('refuses a scope one step wider than the actor holds', async () => {
    held['leads:view'] = { allowed: true, scope: 'team' };
    await expect(
      assertDelegationAllowed(context(), grant({ scope: 'department' }), target()),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_CEILING_EXCEEDED' });
  });

  it('allows an equal scope', async () => {
    held['leads:view'] = { allowed: true, scope: 'team' };
    await expect(
      assertDelegationAllowed(context(), grant({ scope: 'team' }), target()),
    ).resolves.toBeUndefined();
  });

  it('allows a narrower scope', async () => {
    held['leads:view'] = { allowed: true, scope: 'department' };
    await expect(
      assertDelegationAllowed(context(), grant({ scope: 'own' }), target()),
    ).resolves.toBeUndefined();
  });

  it('refuses granting a field the actor cannot read', async () => {
    held['leads:view'] = { allowed: true, scope: 'team', fields: ['name'] };
    await expect(
      assertDelegationAllowed(context(), grant({ fields: ['name', 'value'] }), target()),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_CEILING_EXCEEDED' });
  });

  it('applies no ceiling to a revocation, which only narrows access', async () => {
    await expect(
      assertDelegationAllowed(context(), grant({ allowed: false }), target()),
    ).resolves.toBeUndefined();
  });
});

describe('seniority (PRD §4.6)', () => {
  beforeEach(() => {
    held['access:delegate'] = { allowed: true, scope: 'department' };
    held['leads:view'] = { allowed: true, scope: 'department' };
  });

  it('refuses a target at the same level', async () => {
    await expect(
      assertDelegationAllowed(context(), grant(), target({ organizationalLevel: 50 })),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_SENIORITY' });
  });

  it('refuses a more senior target', async () => {
    await expect(
      assertDelegationAllowed(context(), grant(), target({ organizationalLevel: 80 })),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_SENIORITY' });
  });

  it('refuses the actor editing their own access', async () => {
    await expect(
      assertDelegationAllowed(context(), grant(), target({ id: ACTOR, organizationalLevel: 50 })),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_SENIORITY' });
  });

  it('allows a strictly more junior target', async () => {
    await expect(
      assertDelegationAllowed(context(), grant(), target({ organizationalLevel: 49 })),
    ).resolves.toBeUndefined();
  });
});

describe('boundary (PRD §4.6)', () => {
  beforeEach(() => {
    held['leads:view'] = { allowed: true, scope: 'department' };
  });

  it("refuses a target outside the actor's delegate scope", async () => {
    held['access:delegate'] = { allowed: true, scope: 'team' };
    await expect(
      assertDelegationAllowed(context(), grant(), target({ teamId: 'team-9' })),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_BOUNDARY' });
  });

  it('allows a target inside it', async () => {
    held['access:delegate'] = { allowed: true, scope: 'team' };
    await expect(
      assertDelegationAllowed(context(), grant({ scope: 'team' }), target({ teamId: 'team-1' })),
    ).resolves.toBeUndefined();
  });

  it('refuses a target in another tenant outright', async () => {
    held['access:delegate'] = { allowed: true, scope: 'all-people' };
    await expect(
      assertDelegationAllowed(
        context(),
        grant(),
        target({ organizationId: '44444444-4444-7444-8444-444444444444' }),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS_DELEGATION_BOUNDARY' });
  });
});

describe('domain validity (PD-1)', () => {
  it('refuses all-people scope on a business-domain action before any ceiling check', async () => {
    held['access:delegate'] = { allowed: true, scope: 'all-people' };
    held['leads:view'] = { allowed: true, scope: 'all-people' };
    await expect(
      assertDelegationAllowed(context(), grant({ scope: 'all-people' }), target()),
    ).rejects.toMatchObject({ code: 'ACCESS_OVERRIDE_SCOPE_INVALID_FOR_DOMAIN' });
  });
});

describe('Super Admin', () => {
  it('bypasses ceiling, boundary and seniority', async () => {
    const ctx = context(actor({ accountType: 'super-admin' }));
    await expect(
      assertDelegationAllowed(
        ctx,
        grant({ action: 'payroll:view', scope: 'all-people' }),
        target({ organizationalLevel: 99, teamId: 'team-9' }),
      ),
    ).resolves.toBeUndefined();
  });
});
