import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationContext } from '@tapcrm/authz';
import { policyFor } from '@tapcrm/authz';
import { onboardingWorkflowPolicy, registerOnboardingPolicies } from './policy.js';

const organizationId = 'organization-1';

function context(principalOverrides: Partial<PolicyEvaluationContext['principal']> = {}): PolicyEvaluationContext {
  return {
    organizationId,
    requestId: 'request-1',
    memo: new Map(),
    principal: {
      id: 'employee-1',
      organizationId,
      accountType: 'employee',
      departmentId: 'department-1',
      teamId: 'team-1',
      ...principalOverrides,
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'department-1',
      teamIds: async () => new Set(['team-1']),
      poolIds: async () => new Set(['team-1']),
      subordinateIds: async () => new Set<string>(),
      poolMemberIds: async () => new Set<string>(),
    },
  };
}

function workflowResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'onboardingWorkflow',
    id: 'workflow-1',
    organizationId,
    employeeId: 'employee-2',
    createdBy: 'admin-1',
    departmentId: 'department-1',
    teamId: 'team-1',
    ...overrides,
  };
}

describe('onboardingWorkflowPolicy', () => {
  it('registers in authz policy registry', () => {
    registerOnboardingPolicies();
    const policy = policyFor('onboardingWorkflow');
    expect(policy).toBeDefined();
    expect(policy.resourceType).toBe('onboardingWorkflow');
    expect(policy.domain).toBe('people');
  });

  it('rejects cross-organization access unconditionally', async () => {
    const ctx = context();
    const crossOrg = workflowResource({ organizationId: 'other-org' });
    const allowed = await onboardingWorkflowPolicy.check(ctx, 'onboarding:manage', crossOrg, 'all-people');
    expect(allowed).toBe(false);
  });

  it('allows all-people scope', async () => {
    const ctx = context();
    const res = workflowResource();
    const allowed = await onboardingWorkflowPolicy.check(ctx, 'onboarding:manage', res, 'all-people');
    expect(allowed).toBe(true);
  });

  it('allows own scope for the subject employee or creator', async () => {
    const ctx = context({ id: 'employee-2' });
    const res = workflowResource({ employeeId: 'employee-2' });
    const allowed = await onboardingWorkflowPolicy.check(ctx, 'onboarding:manage', res, 'own');
    expect(allowed).toBe(true);

    const ctxCreator = context({ id: 'admin-1' });
    const allowedCreator = await onboardingWorkflowPolicy.check(ctxCreator, 'onboarding:manage', res, 'own');
    expect(allowedCreator).toBe(true);

    const ctxOther = context({ id: 'stranger-99' });
    const deniedOther = await onboardingWorkflowPolicy.check(ctxOther, 'onboarding:manage', res, 'own');
    expect(deniedOther).toBe(false);
  });

  it('evaluates department scope', async () => {
    const ctx = context();
    const matching = workflowResource({ departmentId: 'department-1' });
    const different = workflowResource({ departmentId: 'department-2' });

    expect(await onboardingWorkflowPolicy.check(ctx, 'onboarding:manage', matching, 'department')).toBe(true);
    expect(await onboardingWorkflowPolicy.check(ctx, 'onboarding:manage', different, 'department')).toBe(false);
  });

  it('evaluates team scope', async () => {
    const ctx = context();
    const matching = workflowResource({ teamId: 'team-1' });
    const different = workflowResource({ teamId: 'team-2' });

    expect(await onboardingWorkflowPolicy.check(ctx, 'onboarding:manage', matching, 'team')).toBe(true);
    expect(await onboardingWorkflowPolicy.check(ctx, 'onboarding:manage', different, 'team')).toBe(false);
  });

  it('returns valid SQL fragments for filter across scopes', async () => {
    const ctx = context();
    const allPeople = await onboardingWorkflowPolicy.filter(ctx, 'onboarding:manage', 'all-people');
    expect(allPeople.sql).toBe('TRUE');

    const own = await onboardingWorkflowPolicy.filter(ctx, 'onboarding:manage', 'own');
    expect(own.sql).toContain('w.employee_id');

    const department = await onboardingWorkflowPolicy.filter(ctx, 'onboarding:manage', 'department');
    expect(department.sql).toContain('u.department_id');
  });
});
