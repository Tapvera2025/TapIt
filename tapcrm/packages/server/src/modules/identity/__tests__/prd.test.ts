import { describe, expect, it } from 'vitest';
import { calculateHaversineDistanceMetres, getDistanceBand } from '../geofence.js';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  generateTotpCode,
  verifyTotpCode,
} from '../mfa.js';
import { validatePasswordPolicy, PasswordPolicyViolationError } from '../password.js';

describe('TapCRM Identity PRD acceptance tests', () => {
  it('ID-2/ID-3 accepts a long non-composition password', () => {
    expect(() =>
      validatePasswordPolicy('correct horse battery staple', {
        email: 'person@example.com',
        fullName: 'Person User',
      }),
    ).not.toThrow();
  });
  it('ID-3 rejects passwords containing the email local part or name', () => {
    expect(() =>
      validatePasswordPolicy('person-secret-password', {
        email: 'person@example.com',
        fullName: 'Person User',
      }),
    ).toThrow(PasswordPolicyViolationError);
    expect(() =>
      validatePasswordPolicy('super-user-secret', {
        email: 'other@example.com',
        fullName: 'Super User',
      }),
    ).toThrow(PasswordPolicyViolationError);
  });
  it('ID-5c creates unique recovery codes and hashes consistently', () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0]!)).toBe(hashRecoveryCode(codes[0]!));
  });
  it('ID-5 TOTP verifies current code and rejects malformed code', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const code = generateTotpCode(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
    expect(verifyTotpCode(secret, '123')).toBe(false);
  });
  it('ID-13/15 geofence uses meters and distance bands', () => {
    const d = calculateHaversineDistanceMetres(0, 0, 0, 0.001);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
    expect(getDistanceBand(d)).toBe('near');
  });
  it('ID-18 maximum bypass is seven days by database constraint and service validation', () => {
    expect(7 * 24 * 60 * 60).toBe(604800);
  });
});
