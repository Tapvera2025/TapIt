import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { TerritoryResource } from './types.js';

export const territoryPolicy: ResourcePolicy<TerritoryResource> = {
  resourceType: 'territory',
  domain: 'business',
  async check(ctx, _action: Action, resource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    // own / participant / pool: the territory's sales team is one the principal
    // sits in or leads (poolIds = own + led teams). A territory has no person
    // column, so there is no people route.
    if (scope === 'own' || scope === 'participant' || scope === 'pool') return (await ctx.scope.poolIds(ctx)).has(resource.salesTeamId);
    if (scope === 'department') return (await ctx.scope.departmentId(ctx)) === resource.departmentId;
    if (scope === 'team') return (await ctx.scope.teamIds(ctx)).has(resource.salesTeamId);
    return false;
  },
  async filter(ctx, _action: Action, scope: Scope) {
    if (scope === 'own' || scope === 'participant' || scope === 'pool') {
      const ids = [...(await ctx.scope.poolIds(ctx))];
      return ids.length ? { sql: 'st.sales_team_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING;
    }
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
