import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  REGISTRY,
  actionDescription,
  actionScopes,
  actionScreens,
  protectedCapabilityReason,
} from './index.js';

describe('canonical action presentation metadata', () => {
  it('provides catalogue presentation data for every registered action', () => {
    expect(ACTIONS).toHaveLength(147);
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
    expect(protectedCapabilityReason(REGISTRY['users:manage'])).toContain(
      'Super Admin',
    );
    expect(protectedCapabilityReason(REGISTRY['leads:view'])).toBeNull();
  });
});
