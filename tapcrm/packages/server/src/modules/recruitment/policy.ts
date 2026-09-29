import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type Resource,
  type ResourcePolicy,
  type SqlFragment,
} from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';

/**
 * Recruitment resource policies.
 *
 * Implements centralized object-level checks and list visibility filters across scopes
 * for all recruitment business domain resources:
 * - jobRequisition
 * - candidate
 * - interview
 * - jobOffer
 * - candidateJoining
 * - recruitmentApplicationLink
 * - candidateResumeSubmission
 *
 * Follows PRD model:
 * Position -> Permission Policy -> Action -> Scope -> Authorization Engine -> Resource Policy -> Allow / Deny
 *
 * Domain: 'business'
 * Scopes supported:
 * - own: creator
 * - participant: assigned interviewer / creator (for interviews)
 * - department: matches requisition / record department
 * - all-people: strictly disallowed for business domain per PD-1
 */

function checkTenantAndScope(
  ctx: PolicyEvaluationContext,
  resource: Resource,
  scope: Scope,
): boolean {
  if (resource['organizationId'] !== ctx.organizationId) return false;
  if (scope === 'all-people') return false; // PD-1: not allowed for business domain
  return true;
}

export const jobRequisitionPolicy: ResourcePolicy = {
  resourceType: 'jobRequisition',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    if (scope === 'own') {
      return resource['createdBy'] === ctx.principal.id;
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return false;
      return resource['departmentId'] === deptId;
    }

    if (scope === 'team') {
      const teamIds = await ctx.scope.teamIds(ctx);
      if (teamIds.size === 0) return false;
      return typeof resource['teamId'] === 'string' && teamIds.has(resource['teamId']);
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own') {
      return { sql: 'job_requisition.created_by = $1', parameters: [ctx.principal.id] };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return MATCH_NOTHING;
      return { sql: 'job_requisition.department_id = $1', parameters: [deptId] };
    }

    if (scope === 'team') {
      const teamIds = [...(await ctx.scope.teamIds(ctx))];
      if (teamIds.length === 0) return MATCH_NOTHING;
      return { sql: 'job_requisition.team_id = ANY($1::uuid[])', parameters: [teamIds] };
    }

    return MATCH_NOTHING;
  },

  participantFields(_action: Action): readonly string[] {
    return [];
  },

  initiatorField(_action: Action): string | null {
    return null;
  },
};

export const candidatePolicy: ResourcePolicy = {
  resourceType: 'candidate',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    if (scope === 'own') {
      return resource['createdBy'] === ctx.principal.id;
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return false;
      const resDeptId = resource['departmentId'] ?? resource['requisitionDepartmentId'];
      return typeof resDeptId === 'string' && resDeptId === deptId;
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own') {
      return { sql: 'candidate.created_by = $1', parameters: [ctx.principal.id] };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return MATCH_NOTHING;
      return {
        sql: 'EXISTS (SELECT 1 FROM job_requisition jr WHERE jr.id = candidate.requisition_id AND jr.department_id = $1)',
        parameters: [deptId],
      };
    }

    return MATCH_NOTHING;
  },

  participantFields(_action: Action): readonly string[] {
    return [];
  },

  initiatorField(_action: Action): string | null {
    return null;
  },
};

export const interviewPolicy: ResourcePolicy = {
  resourceType: 'interview',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    if (scope === 'own') {
      return resource['createdBy'] === ctx.principal.id;
    }

    if (scope === 'participant') {
      const pId = ctx.principal.id;
      if (resource['createdBy'] === pId) return true;
      if (Array.isArray(resource['interviewerIds']) && resource['interviewerIds'].includes(pId)) {
        return true;
      }
      if (
        Array.isArray(resource['interviewers']) &&
        resource['interviewers'].some(
          (i) => i && typeof i === 'object' && ((i as Record<string, unknown>)['userId'] === pId || (i as Record<string, unknown>)['id'] === pId),
        )
      ) {
        return true;
      }
      return false;
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return false;
      const resDeptId = resource['departmentId'] ?? resource['requisitionDepartmentId'];
      return typeof resDeptId === 'string' && resDeptId === deptId;
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own') {
      return { sql: 'interview.created_by = $1', parameters: [ctx.principal.id] };
    }

    if (scope === 'participant') {
      return {
        sql: 'EXISTS (SELECT 1 FROM interview_interviewer ii WHERE ii.interview_id = interview.id AND ii.user_id = $1) OR interview.created_by = $1',
        parameters: [ctx.principal.id],
      };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return MATCH_NOTHING;
      return {
        sql: 'EXISTS (SELECT 1 FROM job_requisition jr WHERE jr.id = interview.requisition_id AND jr.department_id = $1)',
        parameters: [deptId],
      };
    }

    return MATCH_NOTHING;
  },

  participantFields(_action: Action): readonly string[] {
    return ['interviewerIds', 'createdBy'];
  },

  initiatorField(_action: Action): string | null {
    return null;
  },
};

export const jobOfferPolicy: ResourcePolicy = {
  resourceType: 'jobOffer',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    if (scope === 'own') {
      return resource['createdBy'] === ctx.principal.id;
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return false;
      const resDeptId = resource['departmentId'] ?? resource['requisitionDepartmentId'];
      return typeof resDeptId === 'string' && resDeptId === deptId;
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own') {
      return { sql: 'job_offer.created_by = $1', parameters: [ctx.principal.id] };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return MATCH_NOTHING;
      return {
        sql: 'EXISTS (SELECT 1 FROM job_requisition jr WHERE jr.id = job_offer.requisition_id AND jr.department_id = $1)',
        parameters: [deptId],
      };
    }

    return MATCH_NOTHING;
  },

  participantFields(_action: Action): readonly string[] {
    return [];
  },

  initiatorField(_action: Action): string | null {
    return null;
  },
};

export const candidateJoiningPolicy: ResourcePolicy = {
  resourceType: 'candidateJoining',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    if (scope === 'own') {
      return resource['createdBy'] === ctx.principal.id;
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return false;
      const resDeptId = resource['departmentId'] ?? resource['requisitionDepartmentId'];
      return typeof resDeptId === 'string' && resDeptId === deptId;
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own') {
      return { sql: 'candidate_joining.created_by = $1', parameters: [ctx.principal.id] };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return MATCH_NOTHING;
      return {
        sql: 'EXISTS (SELECT 1 FROM job_offer jo JOIN job_requisition jr ON jr.id = jo.requisition_id WHERE jo.id = candidate_joining.offer_id AND jr.department_id = $1)',
        parameters: [deptId],
      };
    }

    return MATCH_NOTHING;
  },

  participantFields(_action: Action): readonly string[] {
    return [];
  },

  initiatorField(_action: Action): string | null {
    return null;
  },
};

export const recruitmentApplicationLinkPolicy: ResourcePolicy = {
  resourceType: 'recruitmentApplicationLink',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    if (scope === 'own') {
      return resource['createdBy'] === ctx.principal.id;
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return false;
      const resDeptId = resource['departmentId'] ?? resource['requisitionDepartmentId'];
      return typeof resDeptId === 'string' && resDeptId === deptId;
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own') {
      return { sql: 'recruitment_application_link.created_by = $1', parameters: [ctx.principal.id] };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return MATCH_NOTHING;
      return {
        sql: 'EXISTS (SELECT 1 FROM job_requisition jr WHERE jr.id = recruitment_application_link.requisition_id AND jr.department_id = $1)',
        parameters: [deptId],
      };
    }

    return MATCH_NOTHING;
  },

  participantFields(_action: Action): readonly string[] {
    return [];
  },

  initiatorField(_action: Action): string | null {
    return null;
  },
};

export const candidateResumeSubmissionPolicy: ResourcePolicy = {
  resourceType: 'candidateResumeSubmission',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    if (scope === 'own') {
      return resource['createdBy'] === ctx.principal.id;
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return false;
      const resDeptId = resource['departmentId'] ?? resource['requisitionDepartmentId'];
      return typeof resDeptId === 'string' && resDeptId === deptId;
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own') {
      return { sql: 'candidate_resume_submission.created_by = $1', parameters: [ctx.principal.id] };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return MATCH_NOTHING;
      return {
        sql: 'EXISTS (SELECT 1 FROM job_requisition jr WHERE jr.id = candidate_resume_submission.requisition_id AND jr.department_id = $1)',
        parameters: [deptId],
      };
    }

    return MATCH_NOTHING;
  },

  participantFields(_action: Action): readonly string[] {
    return [];
  },

  initiatorField(_action: Action): string | null {
    return null;
  },
};

export function registerRecruitmentPolicies(): void {
  registerResourcePolicy(jobRequisitionPolicy);
  registerResourcePolicy(candidatePolicy);
  registerResourcePolicy(interviewPolicy);
  registerResourcePolicy(jobOfferPolicy);
  registerResourcePolicy(candidateJoiningPolicy);
  registerResourcePolicy(recruitmentApplicationLinkPolicy);
  registerResourcePolicy(candidateResumeSubmissionPolicy);
}
