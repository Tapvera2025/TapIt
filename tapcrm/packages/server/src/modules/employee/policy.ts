import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';

const userPolicy: ResourcePolicy = {
  resourceType: 'user',
  domain: 'people',
  async check(ctx, _action, resource, scope: Scope) {
    if (scope === 'all-people') return resource['organizationId'] === ctx.organizationId;
    if (scope === 'own') return resource['id'] === ctx.principal.id;
    if (scope === 'department') return resource['departmentId'] === (ctx.principal.accountType === 'employee' ? ctx.principal.departmentId : null);
    if (scope === 'team') return resource['teamId'] === (ctx.principal.accountType === 'employee' ? ctx.principal.teamId : null);
    return false;
  },
  async filter() { return MATCH_NOTHING; },
  participantFields() { return []; },
  initiatorField() { return null; },
};

export function registerEmployeePolicies(): void {
  registerResourcePolicy(userPolicy);
}
