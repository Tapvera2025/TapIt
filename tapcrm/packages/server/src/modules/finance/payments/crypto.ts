import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(): Buffer {
  const secret = [
    process.env['ENCRYPTION_KEY'],
    process.env['AUDIT_ARCHIVE_ENCRYPTION_KEY'],
    process.env['JWT_ACCESS_SECRET'],
  ].find((value) => typeof value === 'string' && value.trim().length > 0);
  if (!secret) throw new Error('PAYMENT_ENCRYPTION_KEY_MISSING');
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(value: string): string {
  const [ivText, tagText, ciphertextText] = value.split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('PAYMENT_SECRET_FORMAT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
