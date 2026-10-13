/**
 * Sales v1.1 R2 — Delivery brief resource policy.
 *
 * The brief is Sales → Delivery handoff: both the Sales closer and the
 * Delivery reviewer have legitimate reasons to read/act on it. The
 * `delivery:view` + `delivery:approve` actions in the registry carry
 * resource `delivery`, so the loader returns `type: 'delivery'` and
 * this policy is what evaluates scope.
 */

import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type Resource,
  type ResourcePolicy,
  type SqlFragment,
} from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';

export type DeliveryBriefResource = Resource & {
  readonly type: 'delivery';
  readonly organizationId: string;
  /** The owning deal's responsible closer (Sales side). */
  readonly responsibleCloserId: string;
  /** The owning deal's originating agent. */
  readonly originatingAgentId: string;
};

async function membersForScope(
  ctx: PolicyEvaluationContext,
  scope: 'pool' | 'team' | 'department',
): Promise<ReadonlySet<string>> {
  if (scope === 'pool') return ctx.scope.poolMemberIds(ctx);
  if (scope === 'team') return ctx.scope.teamMemberIds(ctx);
  return ctx.scope.departmentMemberIds(ctx);
}

export const deliveryBriefPolicy: ResourcePolicy<DeliveryBriefResource> = {
  resourceType: 'delivery',
  domain: 'business',

  async check(ctx: PolicyEvaluationContext, _action: Action, resource: DeliveryBriefResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'own' || scope === 'participant') {
      return resource.responsibleCloserId === ctx.principal.id
        || resource.originatingAgentId === ctx.principal.id;
    }
    if (scope === 'pool' || scope === 'team' || scope === 'department') {
      const members = await membersForScope(ctx, scope);
      return members.has(resource.responsibleCloserId)
        || members.has(resource.originatingAgentId);
    }
    return false;
  },

  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') {
      return {
        sql: '(delivery_brief.deal_id IN (SELECT id FROM deal WHERE deal.organization_id = delivery_brief.organization_id AND (deal.responsible_closer_id = $1 OR deal.originating_agent_id = $1)))',
        parameters: [ctx.principal.id],
      };
    }
    if (scope === 'pool' || scope === 'team' || scope === 'department') {
      const members = [...(await membersForScope(ctx, scope))];
      if (members.length === 0) return MATCH_NOTHING;
      return {
        sql: '(delivery_brief.deal_id IN (SELECT id FROM deal WHERE deal.organization_id = delivery_brief.organization_id AND (deal.responsible_closer_id = ANY($1::uuid[]) OR deal.originating_agent_id = ANY($1::uuid[]))))',
        parameters: [members],
      };
    }
    return MATCH_NOTHING;
  },

  participantFields: () => ['responsibleCloserId', 'originatingAgentId'],
  initiatorField: () => null,
};

export function registerDeliveryPolicies(): void {
  registerResourcePolicy(deliveryBriefPolicy);
}
