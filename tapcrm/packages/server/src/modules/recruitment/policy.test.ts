import { beforeEach, describe, expect, it } from 'vitest';
import {
  authorize,
  configureAuthz,
  MATCH_NOTHING,
  registerProtectedConstraints,
  __resetConstraints,
  __resetResourcePolicies,
  AuthorizationError,
  type PolicyEvaluationContext,
} from '@tapcrm/authz';
import {
  registerRecruitmentPolicies,
  jobRequisitionPolicy,
  candidatePolicy,
  interviewPolicy,
  jobOfferPolicy,
  candidateJoiningPolicy,
  recruitmentApplicationLinkPolicy,
  candidateResumeSubmissionPolicy,
} from './policy.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-000000000002';

/**
 * HR principal: own dept-hr, no special team/pool membership.
 */
function hrCtx(overrides: Partial<PolicyEvaluationContext> = {}): PolicyEvaluationContext {
  return {
    organizationId: ORG,
    requestId: 'req-hr',
    memo: new Map(),
    principal: {
      id: 'user-hr-1',
      organizationId: ORG,
      accountType: 'employee',
      departmentId: 'dept-hr',
      teamId: 'team-hr',
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'dept-hr',
      teamIds: async () => new Set(['team-hr']),
      poolIds: async () => new Set(),
      subordinateIds: async () => new Set(),
      poolMemberIds: async () => new Set(),
    },
    ...overrides,
  };
}

/**
 * Non-HR principal: belongs to a different department and created nothing in recruitment.
 */
function nonHrCtx(): PolicyEvaluationContext {
  return {
    organizationId: ORG,
    requestId: 'req-non-hr',
    memo: new Map(),
    principal: {
      id: 'user-eng-1',
      organizationId: ORG,
      accountType: 'employee',
      departmentId: 'dept-eng',
      teamId: 'team-eng',
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'dept-eng',
      teamIds: async () => new Set(['team-eng']),
      poolIds: async () => new Set(),
      subordinateIds: async () => new Set(),
      poolMemberIds: async () => new Set(),
    },
  };
}

function requisitionResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'jobRequisition',
    id: 'req-1',
    organizationId: ORG,
    createdBy: 'user-hr-1',
    departmentId: 'dept-hr',
    ...overrides,
  };
}

function candidateResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'candidate',
    id: 'cand-1',
    organizationId: ORG,
    createdBy: 'user-hr-1',
    requisitionDepartmentId: 'dept-hr',
    ...overrides,
  };
}

function interviewResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'interview',
    id: 'int-1',
    organizationId: ORG,
    createdBy: 'user-hr-1',
    interviewerIds: ['user-hr-1'],
    requisitionDepartmentId: 'dept-hr',
    ...overrides,
  };
}

function offerResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'jobOffer',
    id: 'offer-1',
    organizationId: ORG,
    createdBy: 'user-hr-1',
    requisitionDepartmentId: 'dept-hr',
    ...overrides,
  };
}

function joiningResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'candidateJoining',
    id: 'join-1',
    organizationId: ORG,
    createdBy: 'user-hr-1',
    requisitionDepartmentId: 'dept-hr',
    ...overrides,
  };
}

function linkResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'recruitmentApplicationLink',
    id: 'link-1',
    organizationId: ORG,
    createdBy: 'user-hr-1',
    requisitionDepartmentId: 'dept-hr',
    ...overrides,
  };
}

function submissionResource(overrides: Record<string, unknown> = {}) {
  return {
    type: 'candidateResumeSubmission',
    id: 'sub-1',
    organizationId: ORG,
    createdBy: 'user-hr-1',
    requisitionDepartmentId: 'dept-hr',
    ...overrides,
  };
}

beforeEach(() => {
  __resetResourcePolicies();
  __resetConstraints();
  registerProtectedConstraints();
  registerRecruitmentPolicies();

  configureAuthz({
    scope: {
      departmentId: async (ctx) => {
        const p = ctx.principal as { departmentId?: string };
        return p.departmentId ?? null;
      },
      teamIds: async () => new Set(),
      poolIds: async () => new Set(),
      subordinateIds: async () => new Set(),
      poolMemberIds: async () => new Set(),
    },
    policies: {
      resolveSet: async (ctx) => {
        const now = new Date();
        const deadline = new Date(Date.now() + 3600_000);
        // HR principal gets recruitment actions under department scope.
        if ((ctx.principal as { id: string }).id === 'user-hr-1') {
          return {
            policies: {
              'recruitment:view-requisitions': { action: 'recruitment:view-requisitions', allowed: true, scope: 'department', source: 'position' },
              'recruitment:manage-requisitions': { action: 'recruitment:manage-requisitions', allowed: true, scope: 'department', source: 'position' },
              'recruitment:view-candidates': { action: 'recruitment:view-candidates', allowed: true, scope: 'department', source: 'position' },
              'recruitment:manage-candidates': { action: 'recruitment:manage-candidates', allowed: true, scope: 'department', source: 'position' },
              'recruitment:view-interviews': { action: 'recruitment:view-interviews', allowed: true, scope: 'department', source: 'position' },
              'recruitment:manage-interviews': { action: 'recruitment:manage-interviews', allowed: true, scope: 'department', source: 'position' },
              'recruitment:view-offers': { action: 'recruitment:view-offers', allowed: true, scope: 'department', source: 'position' },
              'recruitment:manage-offers': { action: 'recruitment:manage-offers', allowed: true, scope: 'department', source: 'position' },
              'recruitment:view-joining': { action: 'recruitment:view-joining', allowed: true, scope: 'department', source: 'position' },
              'recruitment:manage-joining': { action: 'recruitment:manage-joining', allowed: true, scope: 'department', source: 'position' },
              'recruitment:manage-links': { action: 'recruitment:manage-links', allowed: true, scope: 'department', source: 'position' },
              'recruitment:manage-submissions': { action: 'recruitment:manage-submissions', allowed: true, scope: 'department', source: 'position' },
              'recruitment:view-metrics': { action: 'recruitment:view-metrics', allowed: true, scope: 'own', source: 'position' },
            },
            cacheDeadline: deadline,
            resolvedAt: now,
          };
        }
        // Non-HR principal (interviewer): only participant scope on interviews.
        if ((ctx.principal as { id: string }).id === 'user-interviewer-1') {
          return {
            policies: {
              'recruitment:view-interviews': { action: 'recruitment:view-interviews', allowed: true, scope: 'participant', source: 'position' },
              'recruitment:manage-interviews': { action: 'recruitment:manage-interviews', allowed: true, scope: 'participant', source: 'position' },
            },
            cacheDeadline: deadline,
            resolvedAt: now,
          };
        }
        // Unauthorized user: no recruitment permissions.
        return {
          policies: {},
          cacheDeadline: deadline,
          resolvedAt: now,
        };
      },
    },
    audit: {
      sensitiveUse: () => {},
      superAdminBypass: () => {},
      segregationBlocked: () => {},
      defect: () => {},
    },
    now: () => new Date(),
  });
});

// ============================================================
// jobRequisitionPolicy
// ============================================================
describe('jobRequisitionPolicy', () => {
  it('allows HR user under department scope for their own department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-requisitions', requisitionResource()),
    ).resolves.not.toThrow();
  });

  it('denies HR user for a requisition in a different department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-requisitions', requisitionResource({ departmentId: 'dept-other' })),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies non-HR user with no recruitment permissions', async () => {
    const ctx = nonHrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-requisitions', requisitionResource()),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies cross-tenant access even for HR user', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-requisitions', requisitionResource({ organizationId: OTHER_ORG })),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies all-people scope (PD-1)', async () => {
    const result = await jobRequisitionPolicy.filter(
      hrCtx(),
      'recruitment:view-requisitions',
      'all-people',
    );
    expect(result).toBe(MATCH_NOTHING);
  });

  it('generates a correct department filter', async () => {
    const ctx = hrCtx();
    const filter = await jobRequisitionPolicy.filter(
      ctx,
      'recruitment:view-requisitions',
      'department',
    );
    expect(filter).not.toBe(MATCH_NOTHING);
    expect((filter as { parameters: readonly unknown[] }).parameters[0]).toBe('dept-hr');
  });
});

// ============================================================
// candidatePolicy
// ============================================================
describe('candidatePolicy', () => {
  it('allows HR user for a candidate in their department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-candidates', candidateResource()),
    ).resolves.not.toThrow();
  });

  it('denies HR user for a candidate in a different department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-candidates', candidateResource({ requisitionDepartmentId: 'dept-other' })),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies non-HR user', async () => {
    const ctx = nonHrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-candidates', candidateResource()),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies all-people scope (PD-1)', async () => {
    const result = await candidatePolicy.filter(
      hrCtx(),
      'recruitment:view-candidates',
      'all-people',
    );
    expect(result).toBe(MATCH_NOTHING);
  });
});

// ============================================================
// interviewPolicy — participant scope
// ============================================================
describe('interviewPolicy — participant scope', () => {
  function interviewerCtx(): PolicyEvaluationContext {
    return {
      organizationId: ORG,
      requestId: 'req-interviewer',
      memo: new Map(),
      principal: {
        id: 'user-interviewer-1',
        organizationId: ORG,
        accountType: 'employee',
        departmentId: 'dept-eng',
        teamId: 'team-eng',
      } as PolicyEvaluationContext['principal'],
      scope: {
        departmentId: async () => 'dept-eng',
        teamIds: async () => new Set(['team-eng']),
        poolIds: async () => new Set(),
        subordinateIds: async () => new Set(),
        poolMemberIds: async () => new Set(),
      },
    };
  }

  it('allows an interviewer listed in interviewerIds', async () => {
    const ctx = interviewerCtx();
    await expect(
      authorize(ctx, 'recruitment:view-interviews', interviewResource({
        interviewerIds: ['user-interviewer-1'],
        createdBy: 'user-hr-1',
      })),
    ).resolves.not.toThrow();
  });

  it('denies a non-participant non-HR user', async () => {
    const ctx = nonHrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-interviews', interviewResource()),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies all-people scope (PD-1)', async () => {
    const result = await interviewPolicy.filter(
      hrCtx(),
      'recruitment:view-interviews',
      'all-people',
    );
    expect(result).toBe(MATCH_NOTHING);
  });
});

// ============================================================
// jobOfferPolicy
// ============================================================
describe('jobOfferPolicy', () => {
  it('allows HR user for offer in their department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-offers', offerResource()),
    ).resolves.not.toThrow();
  });

  it('denies HR user for offer in a different department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-offers', offerResource({ requisitionDepartmentId: 'dept-other' })),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies all-people scope (PD-1)', async () => {
    const result = await jobOfferPolicy.filter(
      hrCtx(),
      'recruitment:view-offers',
      'all-people',
    );
    expect(result).toBe(MATCH_NOTHING);
  });
});

// ============================================================
// candidateJoiningPolicy
// ============================================================
describe('candidateJoiningPolicy', () => {
  it('allows HR user for joining in their department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-joining', joiningResource()),
    ).resolves.not.toThrow();
  });

  it('denies non-HR user', async () => {
    const ctx = nonHrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-joining', joiningResource()),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies all-people scope (PD-1)', async () => {
    const result = await candidateJoiningPolicy.filter(
      hrCtx(),
      'recruitment:view-joining',
      'all-people',
    );
    expect(result).toBe(MATCH_NOTHING);
  });
});

// ============================================================
// recruitmentApplicationLinkPolicy
// ============================================================
describe('recruitmentApplicationLinkPolicy', () => {
  it('allows HR user for link in their department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:manage-links', linkResource()),
    ).resolves.not.toThrow();
  });

  it('denies non-HR user', async () => {
    const ctx = nonHrCtx();
    await expect(
      authorize(ctx, 'recruitment:manage-links', linkResource()),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies all-people scope (PD-1)', async () => {
    const result = await recruitmentApplicationLinkPolicy.filter(
      hrCtx(),
      'recruitment:manage-links',
      'all-people',
    );
    expect(result).toBe(MATCH_NOTHING);
  });
});

// ============================================================
// candidateResumeSubmissionPolicy
// ============================================================
describe('candidateResumeSubmissionPolicy', () => {
  it('allows HR user for submission in their department', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:manage-submissions', submissionResource()),
    ).resolves.not.toThrow();
  });

  it('denies non-HR user', async () => {
    const ctx = nonHrCtx();
    await expect(
      authorize(ctx, 'recruitment:manage-submissions', submissionResource()),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies all-people scope (PD-1)', async () => {
    const result = await candidateResumeSubmissionPolicy.filter(
      hrCtx(),
      'recruitment:manage-submissions',
      'all-people',
    );
    expect(result).toBe(MATCH_NOTHING);
  });
});

// ============================================================
// Cross-cutting: missing context fails closed
// ============================================================
describe('authorization fails closed on missing context', () => {
  it('rejects when no permission policy is configured for the principal', async () => {
    const ctx = nonHrCtx();
    // non-HR principal has no recruitment permissions
    await expect(
      authorize(ctx, 'recruitment:manage-candidates', candidateResource()),
    ).rejects.toThrow(AuthorizationError);
  });

  it('rejects cross-tenant resources regardless of scope', async () => {
    const ctx = hrCtx();
    await expect(
      authorize(ctx, 'recruitment:view-candidates', candidateResource({ organizationId: OTHER_ORG })),
    ).rejects.toThrow(AuthorizationError);
  });
});
