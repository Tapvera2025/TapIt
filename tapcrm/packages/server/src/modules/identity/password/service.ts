import argon2 from 'argon2';
import { isBreachedPassword, PasswordBreachServiceError } from './repository.js';
import { IdentityServiceUnavailableError, IdentityValidationError } from '../errors.js';

export function validatePasswordShape(password: string): void {
  if (password.length < 12) throw new IdentityValidationError('IDENTITY_PASSWORD_POLICY_INVALID', 'Password must be at least 12 characters');
  if (password.length > 200) throw new IdentityValidationError('IDENTITY_PASSWORD_POLICY_INVALID', 'Password must be at most 200 characters');
}

export async function assertPasswordPolicy(password: string): Promise<void> {
  validatePasswordShape(password);
  try {
    if (await isBreachedPassword(password)) throw new IdentityValidationError('IDENTITY_PASSWORD_BREACHED', 'Choose a password that has not appeared in a known data breach');
  } catch (error) {
    if (error instanceof IdentityValidationError) throw error;
    if (error instanceof PasswordBreachServiceError)
      throw new IdentityServiceUnavailableError('IDENTITY_PASSWORD_BREACH_CHECK_UNAVAILABLE', 'Password security validation is temporarily unavailable');
    throw error;
  }
}

export async function hashIdentityPassword(password: string): Promise<string> {
  await assertPasswordPolicy(password);
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 4 });
}

export async function verifyIdentityPassword(hash: string, password: string): Promise<boolean> {
  try { return await argon2.verify(hash, password); } catch { return false; }
}
