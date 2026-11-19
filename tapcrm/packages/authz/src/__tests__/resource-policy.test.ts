import { describe, it, expect, beforeEach } from 'vitest';
import {
  assertResourcePoliciesForActions,
  assertResourcePolicyCompleteness,
  missingResourcePolicies,
  registerResourcePolicy,
  __resetResourcePolicies,
  AuthorizationConfigError,
  MATCH_NOTHING,
} from '../index.js';

/**
 * AZ-I6b at startup: the server requires a policy for every resource a
 * registered route can reach, in every environment, while resources of
 * modules that have not shipped (no route binds them) are only reported.
 */

function registerDealPolicy(): void {
  registerResourcePolicy({
    resourceType: 'deal',
    domain: 'business',
    check: async () => true,
    filter: async () => MATCH_NOTHING,
    participantFields: () => [],
    initiatorField: () => null,
  });
}

describe('resource policy completeness — AZ-I6b', () => {
  beforeEach(() => {
    __resetResourcePolicies();
  });

  it('refuses a route-bound action whose resource has no policy', () => {
    expect(() => assertResourcePoliciesForActions(['deals:view'])).toThrow(AuthorizationConfigError);
    expect(() => assertResourcePoliciesForActions(['deals:view'])).toThrow(/deal \(required by deals:view\)/);
  });

  it('accepts route-bound actions once their resource has a policy', () => {
    registerDealPolicy();
    expect(() => assertResourcePoliciesForActions(['deals:view', 'deals:create'])).not.toThrow();
  });

  it('ignores actions that name no resource', () => {
    expect(() => assertResourcePoliciesForActions(['accounting:tax-export'])).not.toThrow();
  });

  it('does not require resources that no route reaches', () => {
    registerDealPolicy();
    // `invoice` has no policy and no route binds `invoicing:view` here.
    expect(() => assertResourcePoliciesForActions(['deals:view'])).not.toThrow();
    expect(missingResourcePolicies()).toContain('invoice (required by invoicing:view)');
  });

  it('keeps the full-registry check strict for a release build', () => {
    registerDealPolicy();
    expect(() => assertResourcePolicyCompleteness()).toThrow(AuthorizationConfigError);
  });
});
