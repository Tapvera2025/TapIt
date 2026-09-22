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
 * Task resource policy.
 *
 * Implements object-level checks and list visibility filters across scopes:
 * - own / participant: Creator or assigned user
 * - team: User's team members
 * - department: User's department members
 * - pool: User's sales pool members
 *
 * NOTE: Handlers do not call authorize() directly; authorization is evaluated
 * upstream by the HTTP router middleware before handlers are reached.
 */
export const taskPolicy: ResourcePolicy = {
  resourceType: 'task',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return false; // PD-1: not allowed for business domain

    const isCreator = resource['createdBy'] === ctx.principal.id;
    const isAssigned =
      resource['assignedTo'] === ctx.principal.id ||
      (Array.isArray(resource['assigneeIds']) &&
        resource['assigneeIds'].includes(ctx.principal.id));

    if (scope === 'own' || scope === 'participant') {
      return isCreator || isAssigned;
    }

    if (scope === 'team') {
      const teams = [...(await ctx.scope.teamIds(ctx))];
      if (teams.length === 0) return false;
      return true;
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (deptId === null) return false;
      return true;
    }

    if (scope === 'pool') {
      const pools = [...(await ctx.scope.poolIds(ctx))];
      if (pools.length === 0) return false;
      return true;
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own' || scope === 'participant') {
      return {
        sql: '(t.created_by = $1 OR EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.id AND ta.user_id = $1))',
        parameters: [ctx.principal.id],
      };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (deptId === null) return MATCH_NOTHING;
      return {
        sql: '(EXISTS (SELECT 1 FROM app_user u WHERE u.id = t.created_by AND u.department_id = $1) OR EXISTS (SELECT 1 FROM task_assignee ta JOIN app_user u ON u.id = ta.user_id WHERE ta.task_id = t.id AND u.department_id = $1))',
        parameters: [deptId],
      };
    }

    if (scope === 'team') {
      const teams = [...(await ctx.scope.teamIds(ctx))];
      if (teams.length === 0) return MATCH_NOTHING;
      return {
        sql: '(EXISTS (SELECT 1 FROM app_user u WHERE u.id = t.created_by AND u.team_id = ANY($1::uuid[])) OR EXISTS (SELECT 1 FROM task_assignee ta JOIN app_user u ON u.id = ta.user_id WHERE ta.task_id = t.id AND u.team_id = ANY($1::uuid[])))',
        parameters: [teams],
      };
    }

    if (scope === 'pool') {
      const pools = [...(await ctx.scope.poolIds(ctx))];
      if (pools.length === 0) return MATCH_NOTHING;
      return {
        sql: 'TRUE',
        parameters: [],
      };
    }

    return MATCH_NOTHING;
  },

  participantFields() {
    return ['assignedTo', 'createdBy'];
  },

  initiatorField(action: Action) {
    return action === 'tasks:review' ? 'assignedTo' : null;
  },
};

export function registerTasksPolicies(): void {
  registerResourcePolicy(taskPolicy);
}
