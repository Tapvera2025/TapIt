import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREDENTIALS_KEY_ENV, credentialsHint, credentialsKeyConfigured, decryptCredentials, encryptCredentials } from './crypto.js';

const owner = { organizationId: 'org-1', connectionId: 'conn-1', provider: 'justcall' as const };
const credentials = { provider: 'justcall' as const, apiKey: 'jc_live_key_123456', apiSecret: 'jc_secret_abcdef' };

describe('telephony credentials at rest', () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env[CREDENTIALS_KEY_ENV];
    process.env[CREDENTIALS_KEY_ENV] = randomBytes(32).toString('hex');
  });
  afterEach(() => {
    if (previous === undefined) delete process.env[CREDENTIALS_KEY_ENV];
    else process.env[CREDENTIALS_KEY_ENV] = previous;
  });

  it('round-trips and never stores the plaintext', () => {
    const envelope = encryptCredentials(credentials, owner);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain('jc_live_key');
    expect(decryptCredentials(envelope, owner)).toEqual(credentials);
  });

  it('will not decrypt for another company, connection or provider', () => {
    const envelope = encryptCredentials(credentials, owner);
    expect(() => decryptCredentials(envelope, { ...owner, organizationId: 'org-2' })).toThrow(/could not be read/);
    expect(() => decryptCredentials(envelope, { ...owner, connectionId: 'conn-2' })).toThrow(/could not be read/);
    expect(() => decryptCredentials(envelope, { ...owner, provider: 'aircall' })).toThrow(/could not be read/);
  });

  it('accepts a base64 key and rejects a tampered envelope', () => {
    process.env[CREDENTIALS_KEY_ENV] = randomBytes(32).toString('base64');
    const envelope = encryptCredentials(credentials, owner);
    const parts = envelope.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]!.slice(0, -2)}AA`].join('.');
    expect(() => decryptCredentials(tampered, owner)).toThrow(/could not be read/);
  });

  it('explains the missing server key instead of storing anything', () => {
    delete process.env[CREDENTIALS_KEY_ENV];
    expect(credentialsKeyConfigured()).toBe(false);
    expect(() => encryptCredentials(credentials, owner)).toThrow(/TELEPHONY_CREDENTIALS_KEY/);
  });

  it('shows only the last four characters', () => {
    expect(credentialsHint(credentials)).toBe('••••3456');
    expect(credentialsHint({ provider: 'aircall', apiId: 'abcdef987654', apiToken: 'x' })).toBe('••••7654');
  });
});
