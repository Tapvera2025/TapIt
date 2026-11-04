import type { Action } from '@tapcrm/contracts';
import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type ResourcePolicy,
} from '@tapcrm/authz';
const policy: ResourcePolicy = {
  resourceType: 'invoice',
  domain: 'business',
  async check(ctx, _action, resource) {
    return resource['organizationId'] === ctx.organizationId;
  },
  async filter(_ctx, action, scope) {
    return scope === 'all-people' &&
      ['invoicing:issue', 'receivables:write-off'].includes(action)
      ? MATCH_NOTHING
      : { sql: 'TRUE', parameters: [] };
  },
  participantFields() {
    return [];
  },
  initiatorField(action: Action) {
    if (action === 'invoicing:issue') return 'createdBy';
    if (action === 'receivables:write-off') return 'proposedBy';
    return null;
  },
};
export function registerInvoicingPolicies() {
  registerResourcePolicy(policy);
}
