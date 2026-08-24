import { describe, it, expect, beforeEach } from 'vitest';
import type { Action, PermissionSet, Principal, Scope } from '@tapcrm/contracts';
import { REGISTRY } from '@tapcrm/contracts';
import {
  authorize,
  visibilityFilter,
  project,
  configureAuthz,
  registerProtectedConstraints,
  registerResourcePolicy,
  __resetConstraints,
  __resetResourcePolicies,
  AuthorizationError,
  MATCH_NOTHING,
  isMatchNothing,
  type AuthzContext,
  type Resource,
} from '../index.js';

/**
 * Authorization engine tests.
 *
 * TS-I1 notes that testing the engine directly "proves the engine works, not
 * that the endpoint uses it" — the HTTP-level suite (TS-2, TS-10) is separate
 * and required. These cover the pipeline invariants that must hold before any
 * endpoint is worth testing.
 */

const ORG = '11111111-1111-7111-8111-111111111111';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: 'user-1',
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

function context(p: Principal = principal()): AuthzContext {
  return { principal: p, organizationId: ORG, requestId: 'req-1', memo: new Map() };
}

interface Harness {
  policies: Partial<Record<Action, { allowed: boolean; scope: Scope }>>;
  audits: string[];
}

const harness: Harness = { policies: {}, audits: [] };

beforeEach(() => {
  __resetConstraints();
  __resetResourcePolicies();
  harness.policies = {};
  harness.audits = [];

  registerProtectedConstraints();

  configureAuthz({
    scope: {
      subordinateIds: async () => new Set(['user-1', 'user-2']),
      teamIds: async () => new Set(['team-1']),
      poolIds: async () => new Set(['team-1']),
      poolMemberIds: async () => new Set(['user-1']),
      departmentId: async () => 'dept-1',
    },
    policies: {
      resolveSet: async (): Promise<PermissionSet> => ({
        policies: Object.fromEntries(
          Object.entries(harness.policies).map(([action, p]) => [
            action,
            { action: action as Action, ...p, source: 'position' as const },
          ]),
        ),
        cacheDeadline: new Date(Date.now() + 60_000),
        resolvedAt: new Date(),
      }),
    },
    audit: {
      sensitiveUse: (_c, a) => harness.audits.push(`sensitive:${a}`),
      superAdminBypass: (_c, a) => harness.audits.push(`bypass:${a}`),
      segregationBlocked: (_c, a) => harness.audits.push(`sod-blocked:${a}`),
      defect: (_c, d) => harness.audits.push(`defect:${d}`),
    },
    now: () => new Date(),
  });

  registerResourcePolicy({
    resourceType: 'roleChangeRequest',
    domain: 'business',
    check: async (ctx, _a, r, scope) =>
      scope === 'department' ? true : r['requestedBy'] === ctx.principal.id,
    filter: async (ctx, _a, scope) =>
      scope === 'department'
        ? { sql: 'department_id = $1', parameters: ['dept-1'] }
        : scope === 'own'
          ? { sql: 'requested_by = $1', parameters: [ctx.principal.id] }
          : MATCH_NOTHING,
    participantFields: () => ['requestedBy'],
    initiatorField: (a) => (a === 'access:decide-role-change' ? 'requestedBy' : null),
  });

  registerResourcePolicy({
    resourceType: 'payslip',
    domain: 'people',
    check: async () => true,
    filter: async () => MATCH_NOTHING,
    participantFields: () => [],
    initiatorField: () => null,
    fieldPolicy: { net_pay: 'payroll:view', gross_pay: 'payroll:view' },
  });
});

const roleChange = (requestedBy: string): Resource => ({
  type: 'roleChangeRequest',
  id: 'rcr-1',
  requestedBy,
  departmentId: 'dept-1',
});

/* ==================================================================== */

describe('segregation of duties — A1, step 2, before the bypass', () => {
  it('refuses an employee approving their own request', async () => {
    harness.policies['access:decide-role-change'] = { allowed: true, scope: 'department' };
    const ctx = context();

    await expect(
      authorize(ctx, 'access:decide-role-change', roleChange('user-1')),
    ).rejects.toThrow(AuthorizationError);
  });

  it('permits approving someone else’s request', async () => {
    harness.policies['access:decide-role-change'] = { allowed: true, scope: 'department' };
    await expect(
      authorize(context(), 'access:decide-role-change', roleChange('user-2')),
    ).resolves.toBeUndefined();
  });

  /**
   * AC-3 — "Every principal INCLUDING SUPER ADMIN is refused when approving
   * their own request, in every approval-bearing workflow."
   *
   * §3.1: "If the root principal can do both, the control does not exist — it
   * is a convention that happens to be followed."
   */
  it('refuses SUPER ADMIN approving their own request', async () => {
    const superAdmin = principal({ id: 'root', accountType: 'super-admin' });

    await expect(
      authorize(context(superAdmin), 'access:decide-role-change', roleChange('root')),
    ).rejects.toThrow(/A1|initiator|approver/i);

    // SD-5 — the block is logged, not silent.
    expect(harness.audits).toContain('sod-blocked:access:decide-role-change');
    // And it never reached step 4.
    expect(harness.audits).not.toContain('bypass:access:decide-role-change');
  });

  it('refuses when the declared initiator field is ABSENT from the record (SD-B)', async () => {
    harness.policies['access:decide-role-change'] = { allowed: true, scope: 'department' };
    const malformed: Resource = { type: 'roleChangeRequest', id: 'rcr-2' };

    await expect(
      authorize(context(), 'access:decide-role-change', malformed),
    ).rejects.toThrow(/sod_unresolved|absent/i);
  });

  it('covers every approval-bearing action in the registry', () => {
    // CI-7 asserts this too; duplicated here so the guarantee has a test that
    // names it (NF-23: a rule without a test is not implemented).
    const bad = Object.values(REGISTRY).filter(
      (d) => d.approvalBearing && d.initiatorField === null,
    );
    expect(bad).toEqual([]);
    expect(Object.values(REGISTRY).filter((d) => d.approvalBearing).length).toBe(25);
  });
});

describe('super admin bypass — step 4', () => {
  it('allows a non-approval action with no policy, and audits it', async () => {
    const superAdmin = principal({ id: 'root', accountType: 'super-admin' });
    await expect(authorize(context(superAdmin), 'org:view-structure')).resolves.toBeUndefined();
    expect(harness.audits).toContain('bypass:org:view-structure');
  });

  it('is still refused by absolute constraint A3 on an immutable record', async () => {
    const superAdmin = principal({ id: 'root', accountType: 'super-admin' });
    const immutable: Resource = { type: 'roleChangeRequest', id: 'x', immutable: true };

    await expect(
      authorize(context(superAdmin), 'org:manage-departments', immutable),
    ).rejects.toThrow(/A3|immutable/i);
  });
});

describe('policy resolution — step 6', () => {
  it('denies when no policy grants the action', async () => {
    await expect(authorize(context(), 'org:manage-departments')).rejects.toThrow(
      AuthorizationError,
    );
  });

  it('denies when a policy exists but is not allowed', async () => {
    harness.policies['org:view-structure'] = { allowed: false, scope: 'department' };
    await expect(authorize(context(), 'org:view-structure')).rejects.toThrow(/no policy|not allow/i);
  });
});

describe('scope evaluation — step 7', () => {
  it('denies a record outside scope', async () => {
    harness.policies['access:request-role-change'] = { allowed: true, scope: 'own' };
    await expect(
      authorize(context(), 'access:request-role-change', roleChange('someone-else')),
    ).rejects.toThrow(/out_of_scope|outside/i);
  });

  /**
   * PD-1 — evaluating `all-people` against a business-domain resource is "a
   * PROGRAMMING ERROR that fails closed and logs as a defect, NOT a permission
   * denial." Both halves are asserted: it denies, and it logs a defect.
   */
  it('treats all-people against a business resource as a defect, and denies', async () => {
    harness.policies['access:request-role-change'] = { allowed: true, scope: 'all-people' };

    await expect(
      authorize(context(), 'access:request-role-change', roleChange('user-1')),
    ).rejects.toThrow(/PD-1|domain/i);

    expect(harness.audits.some((a) => a.startsWith('defect:PD-1'))).toBe(true);
  });
});

describe('visibilityFilter — AZ-I2', () => {
  it('returns MATCH_NOTHING on denial, never an empty fragment', async () => {
    const filter = await visibilityFilter(context(), 'access:request-role-change');
    expect(isMatchNothing(filter)).toBe(true);
    expect(filter.sql).toBe('FALSE');
    // The dangerous failure would be an empty string, which as a WHERE clause
    // means match everything.
    expect(filter.sql).not.toBe('');
  });

  it('returns a real predicate when granted', async () => {
    harness.policies['access:request-role-change'] = { allowed: true, scope: 'own' };
    const filter = await visibilityFilter(context(), 'access:request-role-change');
    expect(filter.sql).toContain('requested_by');
    expect(filter.parameters).toEqual(['user-1']);
  });

  it('returns MATCH_NOTHING for an unknown action (SE-2 fails closed)', async () => {
    const filter = await visibilityFilter(context(), 'not:a-real-action' as Action);
    expect(isMatchNothing(filter)).toBe(true);
  });
});

describe('projection — AZ-I3, step 9', () => {
  it('DELETES denied fields rather than nulling them', async () => {
    harness.policies['payroll:view'] = { allowed: false, scope: 'own' };
    const record = { id: 'p1', employee: 'Ram', net_pay: '50000', gross_pay: '60000' };

    const projected = await project(context(), 'payroll:view', record, 'payslip');

    // A null would tell the caller the field exists and they cannot have it,
    // which for a payslip is itself information.
    expect('net_pay' in projected).toBe(false);
    expect('gross_pay' in projected).toBe(false);
    expect(projected.employee).toBe('Ram');
  });

  it('keeps fields the caller holds the required action for', async () => {
    harness.policies['payroll:view'] = { allowed: true, scope: 'own' };
    const record = { id: 'p1', net_pay: '50000' };
    const projected = await project(context(), 'payroll:view', record, 'payslip');
    expect(projected.net_pay).toBe('50000');
  });

  it('never leaks internal evaluation hints', async () => {
    harness.policies['payroll:view'] = { allowed: true, scope: 'own' };
    const record = { id: 'p1', __holderIsHr: true, __domain: 'people' };
    const projected = await project(context(), 'payroll:view', record, 'payslip');
    expect(Object.keys(projected)).toEqual(['id']);
  });
});

describe('sensitive actions are audited on USE — SE-7, step 10', () => {
  it('writes an access audit entry when a sensitive action succeeds', async () => {
    harness.policies['org:view-policies'] = { allowed: true, scope: 'department' };
    expect(REGISTRY['org:view-policies'].sensitive).toBe(true);

    await authorize(context(), 'org:view-policies');
    expect(harness.audits).toContain('sensitive:org:view-policies');
  });

  it('does not audit a non-sensitive action', async () => {
    harness.policies['org:view-structure'] = { allowed: true, scope: 'department' };
    expect(REGISTRY['org:view-structure'].sensitive).toBe(false);

    await authorize(context(), 'org:view-structure');
    expect(harness.audits).toEqual([]);
  });
});

describe('client isolation — A2, step 3', () => {
  const client = principal({
    id: 'client-user',
    accountType: 'client',
    clientId: 'acme',
  });

  it('refuses a resource belonging to another account', async () => {
    const other: Resource = { type: 'roleChangeRequest', id: 'x', clientId: 'globex' };
    await expect(authorize(context(client), 'org:view-structure', other)).rejects.toThrow(/A2/);
  });

  it('refuses a resource that declares no client owner (fails closed)', async () => {
    const unowned: Resource = { type: 'roleChangeRequest', id: 'x' };
    await expect(authorize(context(client), 'org:view-structure', unowned)).rejects.toThrow(/A2/);
  });
});
