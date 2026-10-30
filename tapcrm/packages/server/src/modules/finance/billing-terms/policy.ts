import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';

const billingTermsPolicy: ResourcePolicy = {
  resourceType: 'billingTerms',
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
  initiatorField() {
    return null;
  },
};

export function registerBillingTermsPolicies(): void {
  registerResourcePolicy(billingTermsPolicy);
}

