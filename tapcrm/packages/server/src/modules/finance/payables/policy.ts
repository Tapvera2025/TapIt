import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';
import type { Action } from '@tapcrm/contracts';

function organizationPolicy(
  resourceType: string,
  initiator: (action: Action) => string | null,
): ResourcePolicy {
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
    initiatorField: initiator,
  };
}

export function registerPayablesPolicies(): void {
  registerResourcePolicy(organizationPolicy('vendor', () => null));
  registerResourcePolicy(organizationPolicy('vendorBankChange', (action) =>
    action === 'payables:approve-bill' ? 'proposedBy' : null,
  ));
  registerResourcePolicy(organizationPolicy('vendorBill', (action) =>
    action === 'payables:approve-bill' ? 'createdBy' : null,
  ));
  registerResourcePolicy(organizationPolicy('purchaseRequest', (action) =>
    action === 'payables:approve-bill' ? 'requesterId' : null,
  ));
  registerResourcePolicy(organizationPolicy('paymentRun', (action) => {
    if (action === 'payables:execute-run') return 'approvedBy';
    return null;
  }));
}
