import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ApplicationError } from '../../../errors.js';
import { TELEPHONY_ERROR_CODES, TelephonySetupRequiredError } from './errors.js';
import type { ProviderCredentials, TelephonyProvider } from './types.js';

/**
 * Calling-platform API keys at rest.
 *
 * AES-256-GCM with the owning (organization, connection, provider) as
 * additional authenticated data: a ciphertext copied onto another company's
 * or another connection's row fails to decrypt instead of quietly working.
 * The key comes from TELEPHONY_CREDENTIALS_KEY (32 random bytes, hex or
 * base64) and never from the database.
 */

export const CREDENTIALS_KEY_ENV = 'TELEPHONY_CREDENTIALS_KEY';

export interface CredentialOwner {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly provider: TelephonyProvider;
}

function encryptionKey(): Buffer {
  const raw = (process.env[CREDENTIALS_KEY_ENV] ?? '').trim();
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new TelephonySetupRequiredError(
      `Call integrations are not set up on this server yet. Ask your administrator to set ${CREDENTIALS_KEY_ENV} to a random 32-byte key.`,
    );
  }
  return key;
}

/** Throws the setup error when the server cannot store API keys yet. */
export function assertCredentialsKeyConfigured(): void {
  encryptionKey();
}

/** True when the server can store API keys. Lets the UI explain before the admin types a key. */
export function credentialsKeyConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function aad(owner: CredentialOwner): Buffer {
  return Buffer.from(
    JSON.stringify(['tapcrm-telephony-v1', owner.organizationId, owner.connectionId, owner.provider]),
  );
}

export function encryptCredentials(value: ProviderCredentials, owner: CredentialOwner): string {
  if (value.provider !== owner.provider) {
    throw new Error('Credentials provider does not match the connection provider');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(aad(owner));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptCredentials(envelope: string, owner: CredentialOwner): ProviderCredentials {
  const key = encryptionKey();
  try {
    const [version, iv, tag, ciphertext, extra] = envelope.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra !== undefined) throw new Error('invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(aad(owner));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain) as ProviderCredentials;
    if (parsed.provider !== owner.provider) throw new Error('provider mismatch');
    return parsed;
  } catch {
    throw new ApplicationError(
      'The saved API key could not be read. Enter the key again to reconnect.',
      422,
      TELEPHONY_ERROR_CODES.CREDENTIALS_UNREADABLE,
    );
  }
}

/** "••••a1b2": enough to tell two keys apart, useless to anyone who sees it. */
export function credentialsHint(value: ProviderCredentials): string {
  const identifier = value.provider === 'justcall' ? value.apiKey : value.apiId;
  const trimmed = identifier.trim();
  return `••••${trimmed.slice(-4)}`;
}
