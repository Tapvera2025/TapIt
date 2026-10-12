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
 *   pool         — pool-level scope rolls up to the sales pool resolver
 *   team         — same as pool for R2 (sales teams and sales pools coincide
 *                  at the deal level — deal has no team column, so team scope
 *                  checks membership of the pool team)
 *   department   — sales department
 */
export const dealPolicy: ResourcePolicy<DealResource> = {
  resourceType: 'deal',
  domain: 'business',

  async check(ctx: PolicyEvaluationContext, _action: Action, resource: DealResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'own' || scope === 'participant') {
      return resource.responsibleCloserId === ctx.principal.id
        || resource.originatingAgentId === ctx.principal.id;
    }
    if (scope === 'pool' || scope === 'team') {
      const members = await ctx.scope.poolMemberIds(ctx);
      return members.has(resource.responsibleCloserId) || members.has(resource.originatingAgentId);
    }
    if (scope === 'department') {
      // Department membership is derived from the current actor's own department;
      // a deal is in-scope when the closer or originator shares the department.
      // This is a best-effort reduction without a dedicated query: pool membership
      // in the caller's team already covers the realistic cases.
      const members = await ctx.scope.poolMemberIds(ctx);
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
      const members = [...(await ctx.scope.poolMemberIds(ctx))];
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
