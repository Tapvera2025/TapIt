import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';

function organizationPolicy(resourceType: string): ResourcePolicy {
  return {
    resourceType,
    domain: 'business',
    async check(ctx, _action, resource) {
      return resource['organizationId'] === ctx.organizationId;
    },
    async filter(_ctx, _action, scope) {
      return scope === 'all-people' ? MATCH_NOTHING : { sql: 'TRUE', parameters: [] };
    },
    participantFields() {
      return [];
    },
    initiatorField(action) {
      return action === 'accounting:close-period' ? 'lastPostedBy' : null;
    },
  };
}

export function registerAccountingPolicies(): void {
  registerResourcePolicy(organizationPolicy('ledgerAccount'));
  registerResourcePolicy(organizationPolicy('accountingPeriod'));
  registerResourcePolicy(organizationPolicy('journalEntry'));
}
