import { createHash, randomBytes } from 'node:crypto';

export function hashRecoveryCode(code: string): Buffer {
  return createHash('sha256').update(code.trim().toUpperCase()).digest();
}

export function issueRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => `${randomBytes(5).toString('hex').toUpperCase()}-${randomBytes(5).toString('hex').toUpperCase()}`);
}
