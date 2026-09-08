import type { Request, Response } from 'express';
import { z } from 'zod';
import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { hashToken } from '../../platform/auth/crypto.js';
import { hashIdentityPassword } from './password/service.js';
import { IdentityConflictError, IdentityNotFoundError, IdentityValidationError } from './errors.js';

const schema = z.object({
  token: z.string().min(20),
  password: z.string().min(12).max(200),
  fullName: z.string().trim().min(2).max(160),
});

/** Company Admin accepts the Master Admin invitation and becomes tenant Super Admin. */
export async function acceptAdminInvitation(req: Request, res: Response): Promise<void> {
  const body = schema.parse(req.body);
  const tokenHash = hashToken(body.token);

  const invitationPreview = await platformDb.query<{ organizationId: string }>(
    'health-check',
    'resolve invitation tenant',
    sql`SELECT organization_id FROM admin_invitation WHERE token_hash = ${tokenHash}`,
  );
  const invitationOrg = invitationPreview[0]?.organizationId;
  if (!invitationOrg) throw new IdentityNotFoundError('IDENTITY_INVITATION_NOT_FOUND', 'Invitation not found');

  const result = await platformDb.transactionForOrganization(
    invitationOrg,
    'organization-provisioning',
    'accept company admin invitation and create tenant user',
    async (tx) => {
      // Lock the organization before checking for an existing admin so two
      // simultaneous invitation acceptances cannot both create a Super Admin.
      const organization = await tx.maybeOne<{ status: 'active' | 'suspended' }>(sql`
        SELECT status FROM organization WHERE id = ${invitationOrg} FOR UPDATE
      `);
      if (!organization) throw new IdentityNotFoundError('IDENTITY_INVITATION_NOT_FOUND', 'Invitation not found');
      if (organization.status !== 'active')
        throw new IdentityValidationError('IDENTITY_ORGANIZATION_SUSPENDED', 'This company is suspended and cannot accept invitations');
      const invitation = (
        await tx.query<{
          id: string;
          organizationId: string;
          email: string;
          expiresAt: Date;
          acceptedAt: Date | null;
          revokedAt: Date | null;
        }>(sql`
      SELECT id, organization_id, email, expires_at, accepted_at, revoked_at
      FROM admin_invitation WHERE token_hash = ${tokenHash} FOR UPDATE
    `)
      )[0];
      if (!invitation) throw new IdentityNotFoundError('IDENTITY_INVITATION_NOT_FOUND', 'Invitation not found');
      if (
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= new Date()
      )
        throw new IdentityValidationError('IDENTITY_INVITATION_INVALID', 'Invitation is expired, revoked, or already accepted');

      const existing = await tx.query<{ id: string }>(
        sql`SELECT id FROM app_user WHERE organization_id = ${invitation.organizationId} AND account_type = 'super-admin' AND status <> 'offboarded' LIMIT 1`,
      );
      if (existing.length)
        throw new IdentityConflictError('IDENTITY_SUPER_ADMIN_EXISTS', 'This organization already has a Super Admin');

      const passwordHash = await hashIdentityPassword(body.password);
      const user = await tx.one<{ id: string }>(sql`
      INSERT INTO app_user(organization_id, account_type, email, password_hash, status, email_verified_at, mfa_required, full_name)
      VALUES (${invitation.organizationId}, 'super-admin', ${invitation.email}, ${passwordHash}, 'active', now(), true, ${body.fullName})
      RETURNING id
    `);
      await tx.query(
        sql`UPDATE admin_invitation SET accepted_at = now() WHERE id = ${invitation.id}`,
      );
      return {
        userId: user.id,
        organizationId: invitation.organizationId,
        email: invitation.email,
      };
    },
  );

  res
    .status(201)
    .json({
      success: true,
      data: result,
      message: 'Company Admin account created. MFA is required for this account.',
    });
}
