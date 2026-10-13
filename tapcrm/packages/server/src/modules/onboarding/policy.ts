import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type Resource,
  type ResourcePolicy,
  type SqlFragment,
} from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';

export const onboardingWorkflowPolicy: ResourcePolicy = {
  resourceType: 'onboardingWorkflow',
  domain: 'people',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own') {
      return (
        resource['employeeId'] === ctx.principal.id ||
        resource['createdBy'] === ctx.principal.id
      );
    }
    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      return deptId !== null && resource['departmentId'] === deptId;
    }
    if (scope === 'team') {
      const teamId = resource['teamId'];
      return typeof teamId === 'string' && (await ctx.scope.teamIds(ctx)).has(teamId);
    }
    if (scope === 'pool') {
      const teamId = resource['teamId'];
      return typeof teamId === 'string' && (await ctx.scope.poolIds(ctx)).has(teamId);
    }
    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own') {
      return {
        sql: '(w.employee_id = $1 OR w.created_by = $1)',
        parameters: [ctx.principal.id],
      };
    }
    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      return deptId === null
        ? MATCH_NOTHING
        : { sql: 'u.department_id = $1', parameters: [deptId] };
    }
    if (scope === 'team') {
      const teams = [...(await ctx.scope.teamIds(ctx))];
      return teams.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [teams] };
    }
    if (scope === 'pool') {
      const pools = [...(await ctx.scope.poolIds(ctx))];
      return pools.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [pools] };
    }
    return MATCH_NOTHING;
  },

  participantFields(): readonly string[] {
    return [];
  },

  initiatorField(): string | null {
    return null;
  },
};

export function registerOnboardingPolicies(): void {
  registerResourcePolicy(onboardingWorkflowPolicy);
}
