import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type ResourcePolicy,
} from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';

export const userPolicy: ResourcePolicy = {
  resourceType: 'user',
  domain: 'people',
  async check(ctx, _action, resource, scope: Scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own') return resource['id'] === ctx.principal.id;
    if (scope === 'department') {
      return resource['departmentId'] === (await ctx.scope.departmentId(ctx));
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
  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId === null
        ? MATCH_NOTHING
        : { sql: 'u.department_id = $1', parameters: [departmentId] };
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
  participantFields() {
    return [];
  },
  initiatorField() {
    return null;
  },
};

export function registerEmployeePolicies(): void {
  registerResourcePolicy(userPolicy);
}
