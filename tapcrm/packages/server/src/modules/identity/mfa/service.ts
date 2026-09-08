import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';
import { hashRecoveryCode, issueRecoveryCodes } from './recovery.js';

export type Assurance = 'high' | 'low';
export type MfaMethod = 'passkey' | 'totp' | 'email-otp' | 'recovery-code';

export function requiresHighAssurance(accountType: string, holdsPrivilegedPolicy: boolean): boolean {
  return accountType === 'super-admin' || holdsPrivilegedPolicy;
}

export async function positionRequiresHighAssurance(tx: Tx, userId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ required: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM app_user u
      JOIN position_policy pp ON pp.organization_id = u.organization_id AND pp.position_id = u.position_id
      JOIN registry_action ra ON ra.action = pp.action
      WHERE u.id = ${userId}
        AND ra.module IN ('payroll', 'access-management', 'system-administration')
        AND pp.allowed = true
    ) AS required
  `);
  return row?.required ?? false;
}

export async function hasHighAssuranceEnrollment(tx: Tx, userId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM mfa_enrollment
    WHERE user_id = ${userId} AND revoked_at IS NULL AND assurance = 'high'
    LIMIT 1
  `);
  return row !== null;
}

export async function createMfaChallenge(tx: Tx, input: { organizationId: string; userId: string; method: MfaMethod; assurance: Assurance; expiresAt: Date }) {
  const token = randomBytes(32).toString('base64url');
  await tx.one(sql`
    INSERT INTO mfa_challenge(organization_id, user_id, method, assurance, challenge_hash, expires_at)
    VALUES (${input.organizationId}, ${input.userId}, ${input.method}, ${input.assurance}, ${createHash('sha256').update(token).digest()}, ${input.expiresAt})
    RETURNING id
  `);
  return token;
}

export async function issueAndStoreRecoveryCodes(tx: Tx, organizationId: string, userId: string): Promise<string[]> {
  const codes = issueRecoveryCodes();
  for (const code of codes) {
    await tx.query(sql`
      INSERT INTO mfa_recovery_code(organization_id, user_id, code_hash)
      VALUES (${organizationId}, ${userId}, ${hashRecoveryCode(code)})
    `);
  }
  return codes;
}

export async function consumeRecoveryCode(tx: Tx, organizationId: string, userId: string, code: string): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM mfa_recovery_code
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
      AND code_hash = ${hashRecoveryCode(code)} AND used_at IS NULL
    FOR UPDATE
  `);
  if (!row) return false;
  await tx.query(sql`UPDATE mfa_recovery_code SET used_at = now() WHERE id = ${row.id}`);
  return true;
}
