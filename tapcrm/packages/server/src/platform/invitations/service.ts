import { createOpaqueToken, hashToken } from '../auth/crypto.js';
import { loadConfig } from '../../config.js';
import { getOrganization } from '../organizations/service.js';
import { platformDb, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { sendAdminInvitation } from '../../modules/identity/notifications/invitation-email.js';
import { PlatformConflictError, PlatformNotFoundError, PlatformValidationError } from '../errors.js';
import * as invitationRepo from './repository.js';

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export async function createInvitationRecord(
  tx: Tx,
  input: { organizationId: string; email: string; createdBy: string; resendCount?: number },
) {
  await tx.query(sql`
    UPDATE admin_invitation SET revoked_at = now()
    WHERE organization_id = ${input.organizationId} AND email = ${input.email.toLowerCase()} AND accepted_at IS NULL AND revoked_at IS NULL
  `);
  const token = createOpaqueToken(32);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const lastSentAt = new Date();
  const row = await tx.one<{ id: string; email: string; expiresAt: Date }>(sql`
    INSERT INTO admin_invitation(organization_id, email, token_hash, expires_at, created_by, resend_count, last_sent_at)
    VALUES (${input.organizationId}, ${input.email.toLowerCase()}, ${hashToken(token)}, ${expiresAt}, ${input.createdBy}, ${input.resendCount ?? 0}, ${lastSentAt})
    RETURNING id, email, expires_at
  `);
  return { row, token, expiresAt, lastSentAt };
}

async function assertCanInvite(organizationId: string) {
  const org = await getOrganization(organizationId);
  if (org.status !== 'active')
    throw new PlatformValidationError('Cannot send an invitation while the company is suspended');
  const activeAdmin = await platformDb.maybeOne<{ id: string }>(
    'health-check',
    'check existing company super admin',
    sql`SELECT id FROM app_user WHERE organization_id = ${organizationId} AND account_type = 'super-admin' AND status = 'active' LIMIT 1`,
  );
  if (activeAdmin) throw new PlatformConflictError('This organization already has an active Super Admin');
  return org;
}

export async function deliverInvitation(input: {
  email: string;
  organizationName: string;
  token: string;
  expiresAt: Date;
}) {
  const base = loadConfig().CLIENT_ORIGIN;
  const invitationUrl = `${base}/accept-invitation?token=${encodeURIComponent(input.token)}`;
  let delivery: 'email' | 'development-log' | 'failed';
  try {
    await sendAdminInvitation({
      to: input.email,
      organizationName: input.organizationName,
      invitationUrl,
      expiresAt: input.expiresAt,
    });
    delivery = process.env['NODE_ENV'] === 'production' ? 'email' : 'development-log';
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'admin invitation delivery failed',
        organizationName: input.organizationName,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    delivery = 'failed';
  }
  return { invitationUrl, delivery };
}

export async function createInvitation(input: {
  organizationId: string;
  email: string;
  createdBy: string;
}) {
  const org = await assertCanInvite(input.organizationId);
  const result = await (
    await import('../../platform/dal/db.js')
  ).platformDb.transaction(
    'organization-provisioning',
    'create company admin invitation',
    async (tx) => createInvitationRecord(tx, input),
  );
  const delivery = await deliverInvitation({
    email: input.email,
    organizationName: org.name,
    token: result.token,
    expiresAt: result.expiresAt,
  });
  return {
    id: result.row.id,
    email: result.row.email,
    expiresAt: result.expiresAt,
    invitationUrl: process.env['NODE_ENV'] === 'production' ? undefined : delivery.invitationUrl,
    delivery: delivery.delivery,
  };
}

export async function resendInvitation(input: {
  organizationId: string;
  email: string;
  createdBy: string;
}) {
  const normalizedEmail = input.email.toLowerCase();
  const result = await platformDb.transaction(
    'organization-provisioning',
    'resend company admin invitation',
    async (tx) => {
      const org = await tx.maybeOne<{ id: string; name: string; status: 'active' | 'suspended' }>(sql`
        SELECT id, name, status FROM organization WHERE id = ${input.organizationId} FOR UPDATE
      `);
      if (!org) throw new PlatformNotFoundError('Organization not found');
      if (org.status !== 'active')
        throw new PlatformValidationError('Cannot resend an invitation while the company is suspended');
      const activeAdmin = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM app_user WHERE organization_id = ${input.organizationId} AND account_type = 'super-admin' AND status = 'active' LIMIT 1
      `);
      if (activeAdmin) throw new PlatformConflictError('This organization already has an active Super Admin');
      const previous = await tx.maybeOne<{ id: string; resendCount: number; lastSentAt: Date }>(sql`
        SELECT id, resend_count, last_sent_at
        FROM admin_invitation
        WHERE organization_id = ${input.organizationId}
          AND email = ${normalizedEmail}
          AND accepted_at IS NULL
          AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `);
      if (previous) {
        const elapsed = Date.now() - previous.lastSentAt.getTime();
        if (elapsed < 60_000) {
          const remaining = Math.ceil((60_000 - elapsed) / 1000);
          throw new PlatformValidationError(`Please wait ${remaining} seconds before resending`);
        }
      }
      const token = createOpaqueToken(32);
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      const lastSentAt = new Date();
      await tx.query(sql`
        UPDATE admin_invitation SET revoked_at = now()
        WHERE organization_id = ${input.organizationId} AND email = ${normalizedEmail} AND accepted_at IS NULL AND revoked_at IS NULL
      `);
      const row = await tx.one<{ id: string; email: string }>(sql`
        INSERT INTO admin_invitation(organization_id, email, token_hash, expires_at, created_by, resend_count, last_sent_at)
        VALUES (${input.organizationId}, ${normalizedEmail}, ${hashToken(token)}, ${expiresAt}, ${input.createdBy}, ${(previous?.resendCount ?? -1) + 1}, ${lastSentAt})
        RETURNING id, email
      `);
      return { org, row, token, expiresAt };
    },
  );
  const delivery = await deliverInvitation({
    email: result.row.email,
    organizationName: result.org.name,
    token: result.token,
    expiresAt: result.expiresAt,
  });
  return {
    id: result.row.id,
    email: result.row.email,
    expiresAt: result.expiresAt,
    invitationUrl: process.env['NODE_ENV'] === 'production' ? undefined : delivery.invitationUrl,
    delivery: delivery.delivery,
  };
}

export async function listInvitations(input: Parameters<typeof invitationRepo.listAll>[0]) {
  return invitationRepo.listAll(input);
}

export async function revokeInvitation(id: string) {
  const revoked = await invitationRepo.revoke(id);
  if (!revoked) throw new PlatformValidationError('Only pending invitations can be revoked');
  return { id, revoked: true };
}
