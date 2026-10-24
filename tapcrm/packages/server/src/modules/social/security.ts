import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { ApplicationError } from '../../errors.js';

export interface CredentialContext {
  organizationId: string;
  clientId: string;
  platform: string;
}

function encryptionKey(): Buffer {
  const raw = process.env['SOCIAL_TOKEN_ENCRYPTION_KEY'] ?? '';
  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (key.length !== 32)
    throw new ApplicationError(
      'Configure SOCIAL_TOKEN_ENCRYPTION_KEY with a random 32-byte key.',
      422,
      'SOCIAL_SETUP_REQUIRED',
    );
  return key;
}

function aad(context: CredentialContext): Buffer {
  return Buffer.from(
    JSON.stringify([
      'tapcrm-social-v1',
      context.organizationId,
      context.clientId,
      context.platform,
    ]),
  );
}

/** AES-GCM binds each credential to its owning organization, client and provider. */
export function encryptCredentials<T>(value: T, context: CredentialContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(aad(context));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptCredentials<T>(encrypted: string, context: CredentialContext): T {
  try {
    const [version, iv, tag, ciphertext, extra] = encrypted.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra)
      throw new Error('invalid envelope');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(aad(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    ) as T;
  } catch {
    throw new ApplicationError(
      'Social credentials could not be decrypted. Check the encryption key or reconnect the account.',
      422,
      'SOCIAL_CREDENTIALS_INVALID',
    );
  }
}

export function hashState(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Never derive OAuth redirect origins from Host or forwarded request headers. */
export function socialBaseUrl(): URL {
  try {
    const url = new URL(process.env['SOCIAL_PUBLIC_BASE_URL'] ?? '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(local && process.env['NODE_ENV'] !== 'production' && url.protocol === 'http:'))
    )
      throw new Error('invalid URL');
    return url;
  } catch {
    throw new ApplicationError(
      'Configure SOCIAL_PUBLIC_BASE_URL as the public CRM HTTPS origin.',
      422,
      'SOCIAL_SETUP_REQUIRED',
    );
  }
}

export function socialSecurityReady(): boolean {
  try {
    encryptionKey();
    socialBaseUrl();
    return true;
  } catch {
    return false;
  }
}
