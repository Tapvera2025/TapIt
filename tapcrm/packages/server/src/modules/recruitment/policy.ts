import {
  MATCH_NOTHING,
  or,
  registerResourcePolicy,
  scopeMemberFilter,
  scopeMemberIds,
  scopeReachesAny,
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
 * - participant: panel member / creator of an interview, to see it
 *   (INTERVIEW_PARTICIPANT_ACTIONS); the interviewer of a candidate's round or
 *   a member of an interview's panel, for INTERVIEWER_ACTIONS
 * - pool / team / department: the structural route (record department / team)
 *   OR the people route — the record's creator (and, for an interview, its
 *   panel) is inside the scope's people (`withPeopleRoute`). Before the people
 *   route, pool and team matched nothing for most of these resources.
 *
 * `participant` is deliberately NOT widened beyond interviews and the
 * assigned-interviewer action carve-out: the starter matrix gives every
 * ordinary employee every recruitment action at `participant`, so letting it
 * reach candidates/offers/joinings would hand them HR's powers.
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

/**
 * What an interviewer does on the round they were assigned: see it, open the
 * candidate's resume and submit feedback. Being assigned names them as a party
 * to that round (`interviewerIds` on the round's resource), whatever scope
 * their position holds the action at — so a Developer Team Manager, a
 * Developer and HR can all interview. It never extends to other recruitment
 * actions: an interviewer cannot edit the candidate or decide the round.
 */
export const INTERVIEWER_ACTIONS: ReadonlySet<Action> = new Set<Action>(['recruitment:submit-round-feedback']);

function isAssignedInterviewer(ctx: PolicyEvaluationContext, action: Action, resource: Resource): boolean {
  const interviewers = resource['interviewerIds'];
  return INTERVIEWER_ACTIONS.has(action) && Array.isArray(interviewers) && interviewers.includes(ctx.principal.id);
}

/**
 * Adds the people route to a recruitment policy for pool / team / department:
 * the record is reachable when any of its people (creator, and for interviews
 * the panel) is inside the scope's members. own / participant stay exactly as
 * the structural policy defines them.
 */
function withPeopleRoute(
  policy: ResourcePolicy,
  people: (resource: Resource) => readonly (string | null | undefined)[],
  columns: readonly string[],
  extraFilter?: (members: readonly string[]) => SqlFragment,
): ResourcePolicy {
  const reaches = (scope: Scope) => scope === 'pool' || scope === 'team' || scope === 'department';
  return {
    ...policy,
    async check(ctx, action, resource, scope) {
      if (await policy.check(ctx, action, resource, scope)) return true;
      if (!reaches(scope) || resource['organizationId'] !== ctx.organizationId) return false;
      return scopeReachesAny(ctx, scope, people(resource));
    },
    async filter(ctx, action, scope) {
      const structural = await policy.filter(ctx, action, scope);
      if (!reaches(scope)) return structural;
      const members = await scopeMemberIds(ctx, scope);
      const route = or(
        await scopeMemberFilter(ctx, scope, columns),
        members && members.size > 0 && extraFilter ? extraFilter([...members]) : MATCH_NOTHING,
      );
      return or(structural, route);
    },
  };
}

function creatorOf(resource: Resource): (string | null)[] {
  return [typeof resource['createdBy'] === 'string' ? resource['createdBy'] : null];
}

function panelOf(resource: Resource): (string | null)[] {
  const ids = Array.isArray(resource['interviewerIds']) ? (resource['interviewerIds'] as unknown[]) : [];
  const objs = Array.isArray(resource['interviewers']) ? (resource['interviewers'] as unknown[]) : [];
  const fromObjs = objs.flatMap((i) => {
    if (!i || typeof i !== 'object') return [];
    const rec = i as Record<string, unknown>;
    return [rec['userId'], rec['id']];
  });
  return [...creatorOf(resource), ...[...ids, ...fromObjs].filter((x): x is string => typeof x === 'string')];
}

const jobRequisitionPolicyBase: ResourcePolicy = {
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

const candidatePolicyBase: ResourcePolicy = {
  resourceType: 'candidate',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    // The interviewer of a round (see INTERVIEWER_ACTIONS).
    if (isAssignedInterviewer(ctx, action, resource)) return true;
    if (scope === 'participant') return false;

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

  participantFields(action: Action): readonly string[] {
    return INTERVIEWER_ACTIONS.has(action) ? ['interviewerIds'] : [];
  },

  initiatorField(_action: Action): string | null {
    return null;
  },
};

/**
 * What being a party to an interview (on its panel, or having scheduled it)
 * allows: seeing it. Running it — its status, rescheduling, the hiring
 * decision, feedback in HR's name — stays with HR's scopes; a panel member
 * gives their own feedback from My Interviews (INTERVIEWER_ACTIONS). Ordinary
 * employees hold every recruitment action at `participant` (starter matrix),
 * so without this a panel member could decide the candidate.
 */
export const INTERVIEW_PARTICIPANT_ACTIONS: ReadonlySet<Action> = new Set<Action>(['recruitment:view-interviews']);

const interviewPolicyBase: ResourcePolicy = {
  resourceType: 'interview',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (!checkTenantAndScope(ctx, resource, scope)) return false;

    if (scope === 'own') {
      return resource['createdBy'] === ctx.principal.id;
    }

    if (scope === 'participant') {
      if (!INTERVIEW_PARTICIPANT_ACTIONS.has(action)) return false;
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

const jobOfferPolicyBase: ResourcePolicy = {
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

const candidateJoiningPolicyBase: ResourcePolicy = {
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

const recruitmentApplicationLinkPolicyBase: ResourcePolicy = {
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

const candidateResumeSubmissionPolicyBase: ResourcePolicy = {
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

export const jobRequisitionPolicy: ResourcePolicy = withPeopleRoute(jobRequisitionPolicyBase, creatorOf, ['job_requisition.created_by']);

export const candidatePolicy: ResourcePolicy = withPeopleRoute(candidatePolicyBase, creatorOf, ['candidate.created_by']);

export const interviewPolicy: ResourcePolicy = withPeopleRoute(interviewPolicyBase, panelOf, ['interview.created_by'], (members) => ({
  sql: 'EXISTS (SELECT 1 FROM interview_interviewer ii WHERE ii.interview_id = interview.id AND ii.user_id = ANY($1::uuid[]))',
  parameters: [members],
}));

export const jobOfferPolicy: ResourcePolicy = withPeopleRoute(jobOfferPolicyBase, creatorOf, ['job_offer.created_by']);

export const candidateJoiningPolicy: ResourcePolicy = withPeopleRoute(candidateJoiningPolicyBase, creatorOf, ['candidate_joining.created_by']);

export const recruitmentApplicationLinkPolicy: ResourcePolicy = withPeopleRoute(recruitmentApplicationLinkPolicyBase, creatorOf, ['recruitment_application_link.created_by']);

// Public submissions have no creator; the reviewer is the only person on the row.
export const candidateResumeSubmissionPolicy: ResourcePolicy = withPeopleRoute(candidateResumeSubmissionPolicyBase, (r) => [typeof r['reviewedBy'] === 'string' ? r['reviewedBy'] : null], ['candidate_resume_submission.reviewed_by']);

export function registerRecruitmentPolicies(): void {
  registerResourcePolicy(jobRequisitionPolicy);
  registerResourcePolicy(candidatePolicy);
  registerResourcePolicy(interviewPolicy);
  registerResourcePolicy(jobOfferPolicy);
  registerResourcePolicy(candidateJoiningPolicy);
  registerResourcePolicy(recruitmentApplicationLinkPolicy);
  registerResourcePolicy(candidateResumeSubmissionPolicy);
}
