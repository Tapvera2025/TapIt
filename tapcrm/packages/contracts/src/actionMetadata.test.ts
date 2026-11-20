import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  REGISTRY,
  actionTitle,
  actionDescription,
  actionScopes,
  actionScreens,
  moduleTitle,
  scopeHint,
  scopeLabel,
  isPositionPolicyGrantable,
  protectedCapabilityReason,
  SUPER_ADMIN_EXCLUSIVE_ACTIONS,
} from './index.js';

describe('canonical action presentation metadata', () => {
  it('provides catalogue presentation data for every registered action', () => {
    expect(ACTIONS).toHaveLength(242);
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
    // Held only through the fixed client-principal policy set, never by a Position.
    expect(isPositionPolicyGrantable(REGISTRY['social:connect-own-accounts'])).toBe(false);
    expect(isPositionPolicyGrantable(REGISTRY['users:view'])).toBe(true);

    for (const action of ACTIONS) {
      const definition = REGISTRY[action];
      const locked =
        !definition.grantPolicy.positionGrantable ||
        definition.grantPolicy.superAdminOnly ||
        SUPER_ADMIN_EXCLUSIVE_ACTIONS.has(action);
      expect(isPositionPolicyGrantable(definition)).toBe(!locked);
      expect(protectedCapabilityReason(definition) !== null).toBe(locked);
    }
  });

  it('lets the Super Admin put "Super Admin only" powers on a position', () => {
    const superAdmin = { superAdmin: true };
    for (const action of [
      'audit:export',
      'telephony:manage',
      'users:change-placement',
      'access:decide-role-change',
      'org:manage-positions',
    ] as const) {
      expect(isPositionPolicyGrantable(REGISTRY[action], superAdmin)).toBe(true);
      expect(protectedCapabilityReason(REGISTRY[action], superAdmin)).toBeNull();
      // Anyone else still sees it locked.
      expect(isPositionPolicyGrantable(REGISTRY[action], { superAdmin: false })).toBe(false);
    }
  });

  it('never puts a non-position power on a position, not even for the Super Admin', () => {
    const superAdmin = { superAdmin: true };
    for (const action of ACTIONS) {
      const definition = REGISTRY[action];
      const never =
        !definition.grantPolicy.positionGrantable || SUPER_ADMIN_EXCLUSIVE_ACTIONS.has(action);
      expect(isPositionPolicyGrantable(definition, superAdmin)).toBe(!never);
    }
    for (const action of ['notepad:view-all', 'billing:set-terms', 'accounting:reopen-period'] as const) {
      expect(protectedCapabilityReason(REGISTRY[action], superAdmin)).toContain('cannot be given to a position');
    }
  });

  it('names every power in plain words for the people handing them out', () => {
    for (const action of ACTIONS) {
      const title = actionTitle(action);
      const description = actionDescription(REGISTRY[action]);
      expect(title.length).toBeGreaterThan(3);
      expect(title).not.toContain(':');
      expect(description.endsWith('.')).toBe(true);
    }
    expect(actionTitle('leave:decide')).toBe('Approve or reject leave');
    expect(moduleTitle('live-status')).toBe('Punching');
    expect(scopeLabel('all-people')).toBe('Everyone in the company');
    expect(scopeHint('team')).toContain('teams under it');
    expect(scopeLabel('unknown-scope')).toBe('unknown-scope');
  });

  it('formats audit event names that are not registry actions', () => {
    expect(actionTitle('employee.updated')).toBe('Employee Updated');
    expect(actionTitle('audit.retention_deleted')).toBe('Audit Retention Deleted');
  });
});
