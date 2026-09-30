import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { TerritoryResource } from './types.js';

export const territoryPolicy: ResourcePolicy<TerritoryResource> = {
  resourceType: 'territory',
  domain: 'business',
  async check(ctx, _action: Action, resource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'department') return (await ctx.scope.departmentId(ctx)) === resource.departmentId;
    if (scope === 'team') return (await ctx.scope.teamIds(ctx)).has(resource.salesTeamId);
    return false;
  },
  async filter(ctx, _action: Action, scope: Scope) {
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId ? { sql: 't.department_id = $1', parameters: [departmentId] } : MATCH_NOTHING;
    }
    if (scope === 'team') {
      const teamIds = [...(await ctx.scope.teamIds(ctx))];
      return teamIds.length ? { sql: 'st.sales_team_id = ANY($1::uuid[])', parameters: [teamIds] } : MATCH_NOTHING;
    }
    return MATCH_NOTHING;
  },
  participantFields: () => [],
  initiatorField: () => null,
};

export function registerTerritoryPolicies(): void { registerResourcePolicy(territoryPolicy); }
