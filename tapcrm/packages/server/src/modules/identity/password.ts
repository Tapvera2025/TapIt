import argon2 from 'argon2';
import { identityDb, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { hashToken, mintScopedToken, parseScopedToken } from './token.js';
import { revokeAllUserSessions } from './sessions.js';
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
    if (
      localPart &&
      localPart.length >= 4 &&
      password.toLowerCase().includes(localPart)
    ) {
      throw new PasswordPolicyViolationError(
        'Password must not contain parts of your email address.',
      );
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

/** Kept as a named export because the reset routes and tests both refer to it. */
export const hashResetToken = hashToken;

/**
 * ID-11 / ID-12 — starts a password reset.
 *
 * Returns without doing anything when the organization, the account or the
 * verification state does not line up. That silence is deliberate: telling a
 * caller "no such account" turns this endpoint into an account-enumeration
 * oracle, and the requirement to send a reset does not include a requirement to
 * confirm who exists.
 *
 * ID-12: "An unverified account can sign in but cannot receive password
 * resets." The reset arrives by email, so an unverified address is exactly the
 * address that must not receive one.
 */
export async function requestPasswordReset(
  organizationCode: string,
  accountType: 'super-admin' | 'employee' | 'client',
  email: string,
): Promise<void> {
  // `organization` is the tenant root and carries no tenant policy — it is the
  // one table that has to be readable before an organization is known.
  const organizations = await platformDb.query<{ id: string; code: string }>(
    {
      operation: 'organization-lookup',
      reason: 'resolve organization code for a password reset',
      tables: ['organization'],
    },
    sql`
      SELECT id, code
      FROM organization
      WHERE lower(code) = lower(${organizationCode.trim()})
        AND status = 'active'
      LIMIT 1
    `,
  );

  const organization = organizations[0];
  if (organization === undefined) return;

  const user = await identityDb.readOne<{
    id: string;
    email: string | null;
    status: string;
    emailVerifiedAt: string | null;
  }>(
    organization.id,
    sql`
      SELECT id, email, status, email_verified_at
      FROM app_user
      WHERE organization_id = ${organization.id}
        AND account_type = ${accountType}
        AND email = ${email}
      LIMIT 1
    `,
  );

  if (user === null || user.status !== 'active' || user.email === null) return;
  if (user.emailVerifiedAt === null) return;

  const token = mintScopedToken(organization.id);

  await identityDb.mustExecute(
    organization.id,
    sql`
      INSERT INTO password_reset_token (organization_id, user_id, token_hash, expires_at)
      VALUES (
        ${organization.id},
        ${user.id},
        ${token.hash},
        now() + (${RESET_TOKEN_TTL_MINUTES} * INTERVAL '1 minute')
      )
    `,
    'password reset token',
  );

  await sendPasswordResetEmail(user.email, token.raw, organization.code);
}

/**
 * ID-11 — consumes a reset token and sets the new password.
 *
 * "Using it invalidates all existing sessions." That is done here rather than
 * left to a background sweep: a password is reset precisely when the old one is
 * believed compromised, and a session that outlives the reset by even a minute
 * defeats the point of resetting.
 *
 * The whole thing is one transaction. A password changed without the token
 * being consumed leaves a live reset link; a token consumed without the
 * password changing locks the user out of their own recovery.
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string,
): Promise<void> {
  const scope = parseScopedToken(rawToken);
  if (scope === null) {
    throw new PasswordPolicyViolationError('Invalid or expired password reset token.');
  }

  const tokenHash = hashToken(rawToken);

  const match = await identityDb.readOne<{
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: string;
    usedAt: string | null;
    email: string | null;
    fullName: string;
  }>(
    scope.organizationId,
    sql`
      SELECT
        prt.id,
        prt.organization_id,
        prt.user_id,
        prt.expires_at,
        prt.used_at,
        u.email,
        u.full_name
      FROM password_reset_token prt
      INNER JOIN app_user u
        ON u.organization_id = prt.organization_id
       AND u.id = prt.user_id
      WHERE prt.organization_id = ${scope.organizationId}
        AND prt.token_hash = ${tokenHash}
      LIMIT 1
    `,
  );

  if (
    match === null ||
    match.usedAt !== null ||
    new Date(match.expiresAt).getTime() <= Date.now()
  ) {
    throw new PasswordPolicyViolationError('Invalid or expired password reset token.');
  }

  validatePasswordPolicy(newPassword, { email: match.email, fullName: match.fullName });
  const newHash = await hashPassword(newPassword);

  await identityDb.transaction(match.organizationId, async (tx) => {
    // Consume the token first, and require it to have been unconsumed. Two
    // requests racing on the same link means exactly one of them proceeds.
    await tx.mustExecute(
      sql`
        UPDATE password_reset_token
        SET used_at = now()
        WHERE organization_id = ${match.organizationId}
          AND id = ${match.id}
          AND used_at IS NULL
      `,
      'password reset token',
    );

    await tx.mustExecute(
      sql`
        UPDATE app_user
        SET password_hash = ${newHash},
            updated_at = now()
        WHERE organization_id = ${match.organizationId}
          AND id = ${match.userId}
      `,
      `password for user ${match.userId}`,
    );
  });

  // ID-7 — every session dies, and the version bump kills access tokens that
  // are already in flight.
  await revokeAllUserSessions(match.organizationId, match.userId, 'password-change');
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
  const users = await identityDb.read<{
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

  await identityDb.mustExecute(
    organizationId,
    sql`
      UPDATE app_user
      SET password_hash = ${newHash},
          updated_at = now()
      WHERE organization_id = ${organizationId}
        AND id = ${userId}
    `,
    `password for user ${userId}`,
  );

  // ID-7 — a password change invalidates every session, here as everywhere
  // else, through the one implementation that also kills the refresh tokens.
  await revokeAllUserSessions(organizationId, userId, 'password-change');
}
