import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  REGISTRY,
  actionTitle,
  actionDescription,
  actionScopes,
  actionScreens,
  isPositionPolicyGrantable,
  protectedCapabilityReason,
} from './index.js';

describe('canonical action presentation metadata', () => {
  it('provides catalogue presentation data for every registered action', () => {
    expect(ACTIONS).toHaveLength(148);
    for (const action of ACTIONS) {
      const definition = REGISTRY[action];
      expect(actionDescription(definition)).not.toBe('');
      expect(actionScreens(definition).length).toBeGreaterThan(0);
      expect(actionScopes(definition).length).toBeGreaterThan(0);
    }
  });

  it('keeps all-people out of business-domain action scopes', () => {
    for (const action of ACTIONS) {
      const definition = REGISTRY[action];
      if (definition.domain === 'business') {
        expect(actionScopes(definition)).not.toContain('all-people');
      }
    }
  });

  it('explains protected position-policy capabilities', () => {
    expect(protectedCapabilityReason(REGISTRY['access:delegate'])).toContain(
      'Super Admin',
    );
    expect(protectedCapabilityReason(REGISTRY['users:manage'])).toBeNull();
    expect(protectedCapabilityReason(REGISTRY['leads:view'])).toBeNull();
    expect(isPositionPolicyGrantable(REGISTRY['access:decide-role-change'])).toBe(false);
    expect(isPositionPolicyGrantable(REGISTRY['billing:set-terms'])).toBe(false);
    expect(isPositionPolicyGrantable(REGISTRY['users:view'])).toBe(true);

    for (const action of ACTIONS) {
      const definition = REGISTRY[action];
      const locked =
        !definition.grantPolicy.positionGrantable ||
        definition.grantPolicy.superAdminOnly;
      expect(isPositionPolicyGrantable(definition)).toBe(!locked);
      expect(protectedCapabilityReason(definition) !== null).toBe(locked);
    }
  });

  it('formats audit event names that are not registry actions', () => {
    expect(actionTitle('employee.updated')).toBe('Employee Updated');
    expect(actionTitle('audit.retention_deleted')).toBe('Audit Retention Deleted');
  });
});
