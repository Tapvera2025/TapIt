import argon2 from 'argon2';
import { isBreachedPassword } from './repository.js';

export function validatePasswordShape(password: string): void {
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
  if (password.length > 200) throw new Error('Password must be at most 200 characters');
}

export async function assertPasswordPolicy(password: string): Promise<void> {
  validatePasswordShape(password);
  if (await isBreachedPassword(password)) throw new Error('Choose a password that has not appeared in a known data breach');
}

export async function hashIdentityPassword(password: string): Promise<string> {
  await assertPasswordPolicy(password);
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 4 });
}

export async function verifyIdentityPassword(hash: string, password: string): Promise<boolean> {
  try { return await argon2.verify(hash, password); } catch { return false; }
}
