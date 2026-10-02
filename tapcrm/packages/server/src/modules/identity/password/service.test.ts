import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('accepts the password when the breach service is down (best-effort, the default)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(assertPasswordPolicy('a-password-that-is-long-enough-123!')).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('still refuses a password the service reports as breached', async () => {
    const suffix = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(new Uint8Array(20).fill(0xff).buffer);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`${suffix}:42\r\n`, { status: 200 }));
    await expect(assertPasswordPolicy('a-password-that-is-long-enough-123!')).rejects.toMatchObject({ code: 'IDENTITY_PASSWORD_BREACHED' });
  });

  describe('PASSWORD_BREACH_CHECK=strict', () => {
    beforeEach(() => { process.env['PASSWORD_BREACH_CHECK'] = 'strict'; });
    afterEach(() => { delete process.env['PASSWORD_BREACH_CHECK']; });

    it('returns a service-unavailable error when the breach service fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));
      await expect(assertPasswordPolicy('a-password-that-is-long-enough-123!')).rejects.toBeInstanceOf(IdentityServiceUnavailableError);
    });
  });

  describe('PASSWORD_BREACH_CHECK=off', () => {
    beforeEach(() => { process.env['PASSWORD_BREACH_CHECK'] = 'off'; });
    afterEach(() => { delete process.env['PASSWORD_BREACH_CHECK']; });

    it('never calls the service but still refuses the built-in common passwords', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await expect(assertPasswordPolicy('a-password-that-is-long-enough-123!')).resolves.toBeUndefined();
      await expect(assertPasswordPolicy('passwordpassword')).rejects.toMatchObject({ code: 'IDENTITY_PASSWORD_BREACHED' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
