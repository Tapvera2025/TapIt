import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityServiceUnavailableError, IdentityValidationError } from '../errors.js';
import { assertPasswordPolicy } from './service.js';

describe('identity password policy errors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a validation error for an invalid password shape', async () => {
    await expect(assertPasswordPolicy('short')).rejects.toBeInstanceOf(IdentityValidationError);
  });

  it('returns a validation error for a breached password', async () => {
    await expect(assertPasswordPolicy('passwordpassword')).rejects.toMatchObject({
      code: 'IDENTITY_PASSWORD_BREACHED',
      status: 422,
    });
  });

  it('returns a service-unavailable error when the breach service fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));
    await expect(assertPasswordPolicy('a-password-that-is-long-enough-123!')).rejects.toBeInstanceOf(IdentityServiceUnavailableError);
  });
});
