import { registerResourcePolicy, type ResourcePolicy, type Resource } from '@tapcrm/authz';

const policy: ResourcePolicy = {
  resourceType: 'geofenceLocation',
  domain: 'people',
  async check(ctx, _action, resource: Resource | null, scope) {
    if (scope === 'all-people') return resource === null || resource['organizationId'] === ctx.organizationId;
    return resource === null ? false : resource['organizationId'] === ctx.organizationId && scope === 'own' && resource['createdBy'] === ctx.principal.id;
  },
  async filter(ctx, _action, scope) {
    return scope === 'all-people'
      ? { sql: 'geofence_location.organization_id = $1', parameters: [ctx.organizationId] }
      : { sql: '1 = 0', parameters: [] };
  },
  participantFields() { return []; },
  initiatorField() { return null; },
};

export function registerGeofencePolicies(): void {
  registerResourcePolicy(policy);
}
