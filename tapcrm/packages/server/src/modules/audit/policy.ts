import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';
import { auditPeopleFilter, type AuditEntryResource } from './repository.js';
import type { LegalHold } from './legal-holds.js';

const auditEntryPolicy: ResourcePolicy<AuditEntryResource> = {
  resourceType: 'auditEntry',
  domain: 'people',
  async check(ctx, _action, resource) {
    return resource.organizationId === ctx.organizationId;
  },
  async filter(_ctx, _action, scope) {
    return scope === 'all-people' ? auditPeopleFilter(scope) : MATCH_NOTHING;
  },
  participantFields() { return []; },
  initiatorField() { return null; },
};

const legalHoldPolicy: ResourcePolicy<LegalHold> = {
  resourceType: 'legalHold',
  domain: 'people',
  async check(ctx, _action, resource) {
    return resource.organizationId === ctx.organizationId;
  },
  async filter(_ctx, _action, scope) {
    return scope === 'all-people' ? { sql: 'TRUE', parameters: [] } : MATCH_NOTHING;
  },
  participantFields() { return []; },
  initiatorField() { return null; },
};

export function registerAuditPolicies(): void {
  registerResourcePolicy(auditEntryPolicy);
  registerResourcePolicy(legalHoldPolicy);
}
