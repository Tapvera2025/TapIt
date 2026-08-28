import argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import { bootstrapDb, platformDb, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { sendPasswordResetEmail } from './email.js';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 1024;
const RESET_TOKEN_TTL_MINUTES = 30;

// Common breached/weak passwords blocklist (ID-3)
const COMMON_PASSWORDS = new Set([
  'password12345',
  '123456789012',
  'qwertyuiop12',
  'admin1234567',
  'welcome12345',
  'letmein12345',
  'changeme1234',
  'tapcrm123456',
]);

export class PasswordPolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordPolicyViolationError';
  }
}

/**
 * ID-3: Password policy check:
 * - Minimum 12 characters
 * - Not in breached/common corpus
 * - Does not trivially contain user's email local-part or name
 */
export function validatePasswordPolicy(
  password: string,
  context?: { email?: string | null; fullName?: string | null },
): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyViolationError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    );
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyViolationError('Password is too long.');
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new PasswordPolicyViolationError(
      'This password is too common and has appeared in known data breaches. Please choose a more secure password.',
    );
  }

  if (context?.email) {
    const localPart = context.email.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 4 && password.toLowerCase().includes(localPart)) {
      throw new PasswordPolicyViolationError('Password must not contain parts of your email address.');
    }
  }

  if (context?.fullName) {
    const names = context.fullName.toLowerCase().split(/\s+/);
    for (const name of names) {
      if (name.length >= 4 && password.toLowerCase().includes(name)) {
        throw new PasswordPolicyViolationError('Password must not contain your name.');
      }
    }
  }
}

/**
 * ID-2: Hash password with Argon2id memory-hard algorithm.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * ID-2: Verify password against Argon2 hash.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Hash raw token for DB storage.
 */
export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * ID-11 / ID-12: Initiates a password reset.
 * An unverified account can sign in but CANNOT receive password resets (ID-12).
 */
export async function requestPasswordReset(
  organizationCode: string,
  accountType: 'super-admin' | 'employee' | 'client',
  email: string,
): Promise<void> {
  // Find organization
  const orgs = await platformDb.query<{ id: string; code: string }>(
    'organization-provisioning',
    'find organization for password reset',
    sql`
      SELECT id, code
      FROM organization
      WHERE code = ${organizationCode}
        AND status = 'active'
      LIMIT 1
    `,
  );

  const org = orgs[0];
  if (!org) {
    // Deliberately do not reveal if org exists
    return;
  }

  // Find user in tenant
  const users = await bootstrapDb.readAs<{
    id: string;
    email: string | null;
    status: string;
    emailVerifiedAt: string | null;
  }>(
    org.id,
    sql`
      SELECT id, email, status, email_verified_at AS "emailVerifiedAt"
      FROM app_user
      WHERE organization_id = ${org.id}
        AND account_type = ${accountType}
        AND email = ${email}
      LIMIT 1
    `,
  );

  const user = users[0];
  if (!user || user.status !== 'active' || !user.email) {
    return;
  }

  // ID-12: An unverified account cannot receive password resets
  if (!user.emailVerifiedAt) {
    return;
  }

  // Generate secure random reset token
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashResetToken(rawToken);

  // Store in password_reset_token table
  await platformDb.query(
    'health-check',
    'create password reset token',
    sql`
      INSERT INTO password_reset_token (
        organization_id,
        user_id,
        token_hash,
        expires_at
      )
      VALUES (
        ${org.id},
        ${user.id},
        ${tokenHash},
        NOW() + (${RESET_TOKEN_TTL_MINUTES} * INTERVAL '1 minute')
      )
    `,
  );

  // Send email (ID-11)
  await sendPasswordResetEmail(user.email, rawToken, org.code);
}

/**
 * ID-11: Consumes a password reset token and sets new password.
 * Increments session_version (ID-7), invalidating all existing sessions.
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string,
): Promise<void> {
  const tokenHash = hashResetToken(rawToken);

  // Look up token across tenants using bootstrap query
  const tokenMatches = await platformDb.query<{
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: string;
    usedAt: string | null;
    email: string | null;
    fullName: string;
  }>(
    'health-check',
    'verify password reset token',
    sql`
      SELECT
        prt.id,
        prt.organization_id AS "organizationId",
        prt.user_id AS "userId",
        prt.expires_at AS "expiresAt",
        prt.used_at AS "usedAt",
        u.email,
        u.full_name AS "fullName"
      FROM password_reset_token prt
      INNER JOIN app_user u
        ON u.id = prt.user_id
       AND u.organization_id = prt.organization_id
      WHERE prt.token_hash = ${tokenHash}
      LIMIT 1
    `,
  );

  const match = tokenMatches[0];
  if (!match || match.usedAt !== null || new Date(match.expiresAt).getTime() <= Date.now()) {
    throw new PasswordPolicyViolationError('Invalid or expired password reset token.');
  }

  // Validate new password against policy
  validatePasswordPolicy(newPassword, {
    email: match.email,
    fullName: match.fullName,
  });

  const newHash = await hashPassword(newPassword);

  // Update password, increment session_version to invalidate all sessions (ID-7), and mark token used
  await platformDb.query(
    'health-check',
    'apply password reset',
    sql`
      UPDATE app_user
      SET
        password_hash = ${newHash},
        session_version = session_version + 1,
        updated_at = NOW()
      WHERE organization_id = ${match.organizationId}
        AND id = ${match.userId}
    `,
  );

  await platformDb.query(
    'health-check',
    'mark reset token as consumed',
    sql`
      UPDATE password_reset_token
      SET used_at = NOW()
      WHERE id = ${match.id}
    `,
  );
}

/**
 * ID-7: Authenticated password change.
 * Increments session_version to invalidate other sessions.
 */
export async function changePassword(
  organizationId: string,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const users = await bootstrapDb.readAs<{
    passwordHash: string | null;
    email: string | null;
    fullName: string;
  }>(
    organizationId,
    sql`
      SELECT
        password_hash AS "passwordHash",
        email,
        full_name AS "fullName"
      FROM app_user
      WHERE organization_id = ${organizationId}
        AND id = ${userId}
      LIMIT 1
    `,
  );

  const user = users[0];
  if (!user || !user.passwordHash) {
    throw new PasswordPolicyViolationError('User not found.');
  }

  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    throw new PasswordPolicyViolationError('Current password is incorrect.');
  }

  validatePasswordPolicy(newPassword, {
    email: user.email,
    fullName: user.fullName,
  });

  const newHash = await hashPassword(newPassword);

  await platformDb.query(
    'health-check',
    'change password and bump session version',
    sql`
      UPDATE app_user
      SET
        password_hash = ${newHash},
        session_version = session_version + 1,
        updated_at = NOW()
      WHERE organization_id = ${organizationId}
        AND id = ${userId}
    `,
  );
}
