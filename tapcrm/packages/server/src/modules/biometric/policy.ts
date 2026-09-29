import {
  AuthorizationError,
  effectivePolicy,
  MATCH_NOTHING,
  registerResourcePolicy,
  type ResourcePolicy,
} from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';

/**
 * `biometricDevice` — device administration is tenant-wide (§10.8).
 *
 * A device, its readers, its PIN mappings and its punch stream serve the whole
 * organization; none belongs to a department or team. So `biometric:manage`
 * reaches them only at `all-people`. Every narrower scope fails closed: an
 * `own` or `team` grant is a misconfiguration, not a partial view.
 */
export const biometricDevicePolicy: ResourcePolicy = {
  resourceType: 'biometricDevice',
  domain: 'people',
  async check(ctx, _action, resource, scope) {
    return resource['organizationId'] === ctx.organizationId && scope === 'all-people';
  },
  async filter(_ctx, _action, scope) {
    return scope === 'all-people' ? { sql: 'TRUE', parameters: [] } : MATCH_NOTHING;
  },
  participantFields: () => [],
  initiatorField: () => null,
};

export function registerBiometricPolicies(): void {
  registerResourcePolicy(biometricDevicePolicy);
}

/**
 * The same rule for the routes with no single device to check: the registry,
 * a new device, a mapping, the punch stream and a replay. The framework has
 * already found a policy for `biometric:manage`; this refuses it unless it is
 * tenant-wide. Super Admin is always tenant-wide.
 */
export async function assertTenantWide(ctx: RequestContext): Promise<void> {
  if (globalAccess(ctx.principal)) return;
  const policy = await effectivePolicy(ctx, 'biometric:manage');
  if (policy?.allowed === true && policy.scope === 'all-people') return;
  throw new AuthorizationError(
    'biometric:manage',
    'out_of_scope',
    'Biometric devices are managed for the whole organization; this grant is narrower.',
  );
}
