import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../../../config.js';
import { ApplicationError } from '../../../errors.js';

/**
 * Seals a person's Google refresh token with MEETINGS_TOKEN_ENCRYPTION_KEY
 * (AES-256-GCM). The ciphertext is bound to its owner, so a sealed token copied
 * onto another person's row does not open.
 */

function key(): Buffer {
  const raw = loadConfig().MEETINGS_TOKEN_ENCRYPTION_KEY ?? '';
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (bytes.length !== 32) {
    throw new ApplicationError(
      'Set MEETINGS_TOKEN_ENCRYPTION_KEY to 32 random bytes (for example `openssl rand -hex 32`) to connect Google Calendars.',
      503,
      'MEETINGS_CALENDAR_NOT_CONFIGURED',
    );
  }
  return bytes;
}

function owner(organizationId: string, userId: string): Buffer {
  return Buffer.from(`tapcrm-calendar-v1:${organizationId}:${userId}`);
}

export function sealSecret(value: string, organizationId: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(owner(organizationId, userId));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function openSecret(sealed: string, organizationId: string, userId: string): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable calendar credential');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(owner(organizationId, userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('base64url');
}

export function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
