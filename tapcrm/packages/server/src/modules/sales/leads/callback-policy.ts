import { MATCH_NOTHING, registerResourcePolicy, type PolicyEvaluationContext, type ResourcePolicy, type SqlFragment } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { Resource } from '@tapcrm/authz';

type CallbackResource = Resource & { organizationId: string; ownerId: string; salesTeamId: string | null; salesPoolId: string | null; departmentId: string | null; status: string };
export const callbackPolicy: ResourcePolicy<CallbackResource> = {
  resourceType: 'callback', domain: 'business',
  async check(ctx: PolicyEvaluationContext, _action: Action, resource: CallbackResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'own' || scope === 'participant') return resource.ownerId === ctx.principal.id;
    if (scope === 'pool') return resource.salesPoolId !== null && (await ctx.scope.poolIds(ctx)).has(resource.salesPoolId);
    if (scope === 'team') return resource.salesTeamId !== null && (await ctx.scope.teamIds(ctx)).has(resource.salesTeamId);
    if (scope === 'department') return resource.departmentId !== null && resource.departmentId === await ctx.scope.departmentId(ctx);
    return false;
  },
  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') return { sql: 'c.owner_id = $1', parameters: [ctx.principal.id] };
    if (scope === 'pool') { const ids = [...(await ctx.scope.poolIds(ctx))]; return ids.length ? { sql: 'l.sales_pool_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING; }
    if (scope === 'team') { const ids = [...(await ctx.scope.teamIds(ctx))]; return ids.length ? { sql: 'l.sales_team_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING; }
    if (scope === 'department') { const id = await ctx.scope.departmentId(ctx); return id ? { sql: 'team.department_id = $1', parameters: [id] } : MATCH_NOTHING; }
    return MATCH_NOTHING;
  },
  participantFields: () => ['ownerId'],
  initiatorField: () => 'ownerId',
};
export function registerCallbackPolicies(): void { registerResourcePolicy(callbackPolicy); }
