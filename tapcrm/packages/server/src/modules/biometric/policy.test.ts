import { describe, expect, it } from 'vitest';
import { MATCH_NOTHING, type PolicyEvaluationContext } from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';
import { biometricDevicePolicy } from './policy.js';

/** Device administration is tenant-wide: every narrower scope fails closed (§10.8). */

const organizationId = 'organization-1';
const context = { organizationId } as unknown as PolicyEvaluationContext;
const device = (overrides: Record<string, unknown> = {}) => ({
  type: 'biometricDevice',
  id: 'device-1',
  organizationId,
  ...overrides,
});

describe('biometricDevice policy', () => {
  it('reaches a device of the tenant at all-people', async () => {
    await expect(
      biometricDevicePolicy.check(context, 'biometric:manage', device(), 'all-people'),
    ).resolves.toBe(true);
  });

  it('never reaches another organization’s device', async () => {
    await expect(
      biometricDevicePolicy.check(
        context,
        'biometric:manage',
        device({ organizationId: 'organization-2' }),
        'all-people',
      ),
    ).resolves.toBe(false);
  });

  it.each<Scope>(['own', 'participant', 'pool', 'team', 'department'])(
    'fails closed at %s',
    async (scope) => {
      await expect(
        biometricDevicePolicy.check(context, 'biometric:manage', device(), scope),
      ).resolves.toBe(false);
      await expect(
        biometricDevicePolicy.filter(context, 'biometric:manage', scope),
      ).resolves.toEqual(MATCH_NOTHING);
    },
  );

  it('lists everything at all-people', async () => {
    await expect(
      biometricDevicePolicy.filter(context, 'biometric:manage', 'all-people'),
    ).resolves.toEqual({ sql: 'TRUE', parameters: [] });
  });
});
