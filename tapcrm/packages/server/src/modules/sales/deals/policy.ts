import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type ResourcePolicy,
  type SqlFragment,
} from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { DealResource } from './types.js';

/**
 * Deal resource policy (R2 plan step 2.7).
 *
 * Visibility ladder (narrowest → widest):
 *   own          — caller is the responsible closer or originating agent
 *   participant  — same as own; deals have no third-party participants
 *   pool         — members of the caller's own sales pool (VIS-4)
 *   team         — members of every team in the caller's team subtree (VIS-1)
 *   department   — every active user in the caller's department
 */
async function membersForScope(
  ctx: PolicyEvaluationContext,
  scope: 'pool' | 'team' | 'department',
): Promise<ReadonlySet<string>> {
  if (scope === 'pool') return ctx.scope.poolMemberIds(ctx);
  if (scope === 'team') return ctx.scope.teamMemberIds(ctx);
  return ctx.scope.departmentMemberIds(ctx);
}

export const dealPolicy: ResourcePolicy<DealResource> = {
  resourceType: 'deal',
  domain: 'business',

  async check(ctx: PolicyEvaluationContext, _action: Action, resource: DealResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'own' || scope === 'participant') {
      return resource.responsibleCloserId === ctx.principal.id
        || resource.originatingAgentId === ctx.principal.id;
    }
    if (scope === 'pool' || scope === 'team' || scope === 'department') {
      const members = await membersForScope(ctx, scope);
      return members.has(resource.responsibleCloserId) || members.has(resource.originatingAgentId);
    }
    return false;
  },

  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') {
      return {
        sql: '(d.responsible_closer_id = $1 OR d.originating_agent_id = $1)',
        parameters: [ctx.principal.id],
      };
    }
    if (scope === 'pool' || scope === 'team' || scope === 'department') {
      const members = [...(await membersForScope(ctx, scope))];
      if (members.length === 0) return MATCH_NOTHING;
      return {
        sql: '(d.responsible_closer_id = ANY($1::uuid[]) OR d.originating_agent_id = ANY($1::uuid[]))',
        parameters: [members],
      };
    }
    return MATCH_NOTHING;
  },

  participantFields: () => ['responsibleCloserId', 'originatingAgentId'],
  initiatorField: () => null,
};

export function registerDealPolicies(): void {
  registerResourcePolicy(dealPolicy);
}
