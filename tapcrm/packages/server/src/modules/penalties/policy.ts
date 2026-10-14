import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type ResourcePolicy,
} from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';

export const makePenaltyResource = (
  id: string,
  organizationId: string,
  employeeId: string,
  departmentId: string | null = null,
  teamId: string | null = null,
) => ({
  type: 'employeePenalty' as const,
  id,
  organizationId,
  subjectId: employeeId,
  userId: employeeId,
  departmentId,
  teamId,
});

const penaltyPolicy: ResourcePolicy = {
  resourceType: 'employeePenalty',
  domain: 'people',
  async check(ctx, _action, resource, scope: Scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    const employeeId = resource['subjectId'];
    if (scope === 'all-people') return true;
    if (scope === 'own') return employeeId === ctx.principal.id;
    if (scope === 'department')
      return resource['departmentId'] === (await ctx.scope.departmentId(ctx));
    if (scope === 'team' || scope === 'pool') {
      const teamId = resource['teamId'];
      if (typeof teamId !== 'string') return false;
      return scope === 'team'
        ? (await ctx.scope.teamIds(ctx)).has(teamId)
        : (await ctx.scope.poolIds(ctx)).has(teamId);
    }
    return false;
  },
  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own')
      return { sql: 'p.employee_id = $1', parameters: [ctx.principal.id] };
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId
        ? { sql: 'u.department_id = $1', parameters: [departmentId] }
        : MATCH_NOTHING;
    }
    if (scope === 'team' || scope === 'pool') {
      const teams =
        scope === 'team' ? await ctx.scope.teamIds(ctx) : await ctx.scope.poolIds(ctx);
      return teams.size > 0
        ? { sql: 'u.team_id = ANY($1::uuid[])', parameters: [[...teams]] }
        : MATCH_NOTHING;
    }
    return MATCH_NOTHING;
  },
  participantFields: () => [],
  initiatorField: () => null,
};

export function registerPenaltyPolicies(): void {
  registerResourcePolicy(penaltyPolicy);
}
