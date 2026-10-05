import type { Request, Response } from 'express';
import { z } from 'zod';
import { bootstrapDb, db, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { hashToken } from '../../platform/auth/crypto.js';
import { hashIdentityPassword } from './password/service.js';
import { IdentityNotFoundError, IdentityValidationError } from './errors.js';
import { createIdentityContext } from './authentication/principal.js';
import { findUserById } from './repository.js';

const setupPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(12).max(200),
  organizationCode: z.string().trim().min(1).optional(),
  org: z.string().trim().min(1).optional(),
});

const verifyTokenSchema = z.object({
  token: z.string().min(20),
  organizationCode: z.string().trim().min(1).optional(),
  org: z.string().trim().min(1).optional(),
});

interface TokenVerificationRow {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  email: string;
  fullName: string;
  userStatus: string;
}

/**
 * Public pre-auth endpoint for employees to complete permanent password setup.
 *
 * Validates the single-use setup token, checks tenant isolation, sets the permanent
 * password hash, invalidates the setup token, clears must_change_password,
 * increments session_version, and records an activity audit event.
 */
export async function setupEmployeePassword(req: Request, res: Response): Promise<void> {
  const body = setupPasswordSchema.parse(req.body ?? {});
  const orgCode = (body.organizationCode || body.org || '').trim().toUpperCase();

  if (!orgCode) {
    throw new IdentityValidationError(
      'IDENTITY_ORGANIZATION_CODE_REQUIRED',
      'Organization code is required',
    );
  }

  const organization = await platformDb.maybeOne<{
    id: string;
    code: string;
    name: string;
    status: 'active' | 'suspended';
  }>(
    'health-check',
    'resolve employee setup token organization',
    sql`SELECT id, code, name, status FROM organization WHERE code = ${orgCode}`,
  );

  if (!organization) {
    throw new IdentityNotFoundError(
      'IDENTITY_SETUP_TOKEN_NOT_FOUND',
      'Invalid or expired setup token',
    );
  }

  if (organization.status !== 'active') {
    throw new IdentityValidationError(
      'IDENTITY_ORGANIZATION_SUSPENDED',
      'This company is suspended and cannot accept account setup',
    );
  }

  const tokenHash = hashToken(body.token);

  const rows = await bootstrapDb.readAs<TokenVerificationRow>(
    organization.id,
    sql`
      SELECT t.id, t.user_id, t.expires_at, t.used_at, t.revoked_at,
             u.email::text AS email, u.full_name, u.status AS user_status
      FROM employee_setup_token t
      JOIN app_user u ON u.id = t.user_id AND u.organization_id = t.organization_id
      WHERE t.organization_id = ${organization.id}
        AND t.token_hash = ${tokenHash}
        AND t.purpose = 'employee_password_setup'
    `,
  );

  const tokenRecord = rows[0];
  if (!tokenRecord) {
    throw new IdentityNotFoundError(
      'IDENTITY_SETUP_TOKEN_NOT_FOUND',
      'Setup link is invalid or not found',
    );
  }

  if (tokenRecord.usedAt) {
    throw new IdentityValidationError(
      'IDENTITY_SETUP_TOKEN_ALREADY_USED',
      'This setup link has already been used. Please log in or request a new link.',
    );
  }

  if (tokenRecord.revokedAt || tokenRecord.expiresAt <= new Date()) {
    throw new IdentityValidationError(
      'IDENTITY_SETUP_TOKEN_EXPIRED',
      'This setup link has expired or been revoked. Please contact your administrator.',
    );
  }

  if (tokenRecord.userStatus !== 'active') {
    throw new IdentityValidationError(
      'IDENTITY_USER_NOT_ACTIVE',
      'Account is not currently active.',
    );
  }

  const passwordHash = await hashIdentityPassword(body.password);
  const identityUser = await findUserById(tokenRecord.userId, organization.id);
  if (!identityUser) {
    throw new IdentityNotFoundError('IDENTITY_USER_NOT_FOUND', 'User not found');
  }

  await db.transaction(
    createIdentityContext(identityUser, `identity:employee-setup:${tokenRecord.userId}`),
    async (tx) => {
      // Atomically mark token as used
      const consumed = await tx.maybeOne<{ id: string }>(sql`
        UPDATE employee_setup_token
        SET used_at = now()
        WHERE id = ${tokenRecord.id}
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING id
      `);

      if (!consumed) {
        throw new IdentityValidationError(
          'IDENTITY_SETUP_TOKEN_INVALID',
          'Setup link is expired, revoked, or already used',
        );
      }

      // Update app_user credential state
      await tx.query(sql`
        UPDATE app_user
        SET password_hash = ${passwordHash},
            must_change_password = false,
            session_version = session_version + 1
        WHERE organization_id = ${organization.id} AND id = ${tokenRecord.userId}
      `);

      // Invalidate all existing sessions for this user
      await tx.query(sql`
        UPDATE session
        SET revoked_at = now()
        WHERE organization_id = ${organization.id}
          AND user_id = ${tokenRecord.userId}
          AND revoked_at IS NULL
      `);

      // Durable audit record
      await tx.query(sql`
        INSERT INTO audit_outbox (organization_id, stream, payload)
        VALUES (
          ${organization.id}, 'activity',
          ${JSON.stringify({
            action: 'employee.password_set',
            actorId: tokenRecord.userId,
            actorType: 'employee',
            targetType: 'user',
            targetId: tokenRecord.userId,
          })}::jsonb
        )
      `);
    },
  );

  res.status(200).json({
    success: true,
    data: {
      email: tokenRecord.email,
      fullName: tokenRecord.fullName,
    },
    message: 'Permanent password set successfully. You can now log in.',
  });
}

/**
 * Public pre-auth endpoint to check if an employee setup link is valid before submitting.
 */
export async function verifyEmployeeSetupToken(req: Request, res: Response): Promise<void> {
  const query = verifyTokenSchema.parse({
    token: req.query['token'],
    organizationCode: req.query['organizationCode'],
    org: req.query['org'],
  });

  const orgCode = (query.organizationCode || query.org || '').trim().toUpperCase();
  if (!orgCode) {
    throw new IdentityValidationError(
      'IDENTITY_ORGANIZATION_CODE_REQUIRED',
      'Organization code is required',
    );
  }

  const organization = await platformDb.maybeOne<{
    id: string;
    code: string;
    name: string;
    status: 'active' | 'suspended';
  }>(
    'health-check',
    'verify employee setup token organization',
    sql`SELECT id, code, name, status FROM organization WHERE code = ${orgCode}`,
  );

  if (!organization) {
    throw new IdentityNotFoundError(
      'IDENTITY_SETUP_TOKEN_NOT_FOUND',
      'Invalid or expired setup token',
    );
  }

  const tokenHash = hashToken(query.token);

  const rows = await bootstrapDb.readAs<TokenVerificationRow>(
    organization.id,
    sql`
      SELECT t.id, t.user_id, t.expires_at, t.used_at, t.revoked_at,
             u.email::text AS email, u.full_name, u.status AS user_status
      FROM employee_setup_token t
      JOIN app_user u ON u.id = t.user_id AND u.organization_id = t.organization_id
      WHERE t.organization_id = ${organization.id}
        AND t.token_hash = ${tokenHash}
        AND t.purpose = 'employee_password_setup'
    `,
  );

  const tokenRecord = rows[0];
  if (!tokenRecord) {
    throw new IdentityNotFoundError(
      'IDENTITY_SETUP_TOKEN_NOT_FOUND',
      'Setup link is invalid or not found',
    );
  }

  if (tokenRecord.usedAt) {
    throw new IdentityValidationError(
      'IDENTITY_SETUP_TOKEN_ALREADY_USED',
      'This setup link has already been used.',
    );
  }

  if (tokenRecord.revokedAt || tokenRecord.expiresAt <= new Date()) {
    throw new IdentityValidationError(
      'IDENTITY_SETUP_TOKEN_EXPIRED',
      'This setup link has expired.',
    );
  }

  res.status(200).json({
    success: true,
    data: {
      valid: true,
      email: tokenRecord.email,
      fullName: tokenRecord.fullName,
      organizationName: organization.name,
      organizationCode: organization.code,
    },
  });
}
