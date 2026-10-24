import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptCredentials,
  encryptCredentials,
  hashState,
  safeEqual,
  socialBaseUrl,
  socialSecurityReady,
} from './security.js';

const context = { organizationId: 'org-a', clientId: 'client-a', platform: 'facebook' };
afterEach(() => vi.unstubAllEnvs());
describe('social credential protection', () => {
  it('encrypts using a fresh nonce and binds ciphertext to client, tenant and provider', () => {
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32));
    const value = {
      accessToken: 'private-access-token',
      refreshToken: 'private-refresh-token',
    };
    const encrypted = encryptCredentials(value, context);
    expect(encrypted).not.toContain(value.accessToken);
    expect(encrypted).not.toEqual(encryptCredentials(value, context));
    expect(decryptCredentials(encrypted, context)).toEqual(value);
    for (const changed of [
      { organizationId: 'org-b' },
      { clientId: 'client-b' },
      { platform: 'linkedin' },
    ]) {
      expect(() => decryptCredentials(encrypted, { ...context, ...changed })).toThrow(
        /could not be decrypted/,
      );
    }
  });
  it('rejects tampered data and a changed key without disclosing secrets', () => {
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32));
    const encrypted = encryptCredentials({ accessToken: 'secret' }, context);
    const parts = encrypted.split('.');
    const bytes = Buffer.from(parts[3]!, 'base64url');
    bytes[0] = bytes[0]! ^ 1;
    parts[3] = bytes.toString('base64url');
    expect(() => decryptCredentials(parts.join('.'), context)).toThrow(
      /could not be decrypted/,
    );
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'cd'.repeat(32));
    expect(() => decryptCredentials(encrypted, context)).toThrow(
      /could not be decrypted/,
    );
  });
  it('fails closed without a full encryption key', () => {
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'short');
    expect(() => encryptCredentials({ accessToken: 'secret' }, context)).toThrow(
      /32-byte/,
    );
    expect(socialSecurityReady()).toBe(false);
  });
});
describe('social OAuth origin and state validation', () => {
  it('accepts an explicit HTTPS origin and local HTTP only during development', () => {
    vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', 'https://crm.example.com');
    expect(socialBaseUrl().origin).toBe('https://crm.example.com');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', 'http://localhost:5173');
    expect(socialBaseUrl().origin).toBe('http://localhost:5173');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => socialBaseUrl()).toThrow(/public CRM HTTPS origin/);
  });
  it('rejects credential-bearing URLs, nonlocal HTTP, fragments, queries and paths', () => {
    for (const url of [
      'http://crm.example.com',
      'https://user:password@crm.example.com',
      'https://crm.example.com?next=evil',
      'https://crm.example.com/#next',
      'https://crm.example.com/redirect',
    ]) {
      vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', url);
      expect(() => socialBaseUrl()).toThrow(/public CRM HTTPS origin/);
    }
  });
  it('compares opaque browser state safely, including differing lengths', () => {
    expect(safeEqual(hashState('nonce'), hashState('nonce'))).toBe(true);
    expect(safeEqual(hashState('nonce'), hashState('other'))).toBe(false);
    expect(safeEqual('', hashState('nonce'))).toBe(false);
  });
});
