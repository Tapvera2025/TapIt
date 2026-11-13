import { MATCH_NOTHING, or, registerResourcePolicy, scopeMemberFilter, scopeReachesAny, type PolicyEvaluationContext, type ResourcePolicy, type SqlFragment } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { Resource } from '@tapcrm/authz';

type CallbackResource = Resource & { organizationId: string; ownerId: string; salesTeamId: string | null; salesPoolId: string | null; departmentId: string | null; status: string };

/**
 * Callback reach: the callback's owner, or the pool / Sales Team / department
 * of the lead it belongs to. Same two routes as the lead policy — people OR
 * team columns — so a callback is visible to exactly the people who can see
 * its lead's work.
 */
export const callbackPolicy: ResourcePolicy<CallbackResource> = {
  resourceType: 'callback', domain: 'business',
  async check(ctx: PolicyEvaluationContext, _action: Action, resource: CallbackResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'own' || scope === 'participant') return resource.ownerId === ctx.principal.id;
    if (await scopeReachesAny(ctx, scope, [resource.ownerId])) return true;
    if (scope === 'pool') return resource.salesPoolId !== null && (await ctx.scope.poolIds(ctx)).has(resource.salesPoolId);
    if (scope === 'team') {
      const teams = await ctx.scope.teamIds(ctx);
      return (resource.salesTeamId !== null && teams.has(resource.salesTeamId)) || (resource.salesPoolId !== null && teams.has(resource.salesPoolId));
    }
    if (scope === 'department') return resource.departmentId !== null && resource.departmentId === await ctx.scope.departmentId(ctx);
    return false;
  },
  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') return { sql: 'c.owner_id = $1', parameters: [ctx.principal.id] };
    const people = await scopeMemberFilter(ctx, scope, ['c.owner_id']);
    if (scope === 'pool') { const ids = [...(await ctx.scope.poolIds(ctx))]; return or(people, ids.length ? { sql: 'l.sales_pool_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING); }
    if (scope === 'team') { const ids = [...(await ctx.scope.teamIds(ctx))]; return or(people, ids.length ? { sql: '(l.sales_team_id = ANY($1::uuid[]) OR l.sales_pool_id = ANY($1::uuid[]))', parameters: [ids] } : MATCH_NOTHING); }
    if (scope === 'department') { const id = await ctx.scope.departmentId(ctx); return id ? or(people, { sql: 'team.department_id = $1', parameters: [id] }) : MATCH_NOTHING; }
    return MATCH_NOTHING;
  },
  participantFields: () => ['ownerId'],
  initiatorField: () => 'ownerId',
};
export function registerCallbackPolicies(): void { registerResourcePolicy(callbackPolicy); }
