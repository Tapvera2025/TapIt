import { platformDb, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export async function revokePending(
  organizationId: string,
  email: string,
): Promise<void> {
  await platformDb.query(
    'organization-provisioning',
    'revoke previous admin invitations',
    sql`
    UPDATE admin_invitation SET revoked_at = now()
    WHERE organization_id = ${organizationId} AND email = ${email.toLowerCase()} AND accepted_at IS NULL AND revoked_at IS NULL
  `,
  );
}

export async function revokePendingInTransaction(
  tx: Tx,
  organizationId: string,
  email: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE admin_invitation SET revoked_at = now()
    WHERE organization_id = ${organizationId} AND email = ${email.toLowerCase()} AND accepted_at IS NULL AND revoked_at IS NULL
  `);
}

export async function create(input: {
  organizationId: string;
  email: string;
  tokenHash: Buffer;
  expiresAt: Date;
  createdBy: string;
}) {
  return platformDb.one<{
    id: string;
    organizationId: string;
    email: string;
    expiresAt: Date;
    createdAt: Date;
  }>(
    'organization-provisioning',
    'create company admin invitation',
    sql`
    INSERT INTO admin_invitation(organization_id, email, token_hash, expires_at, created_by)
    VALUES (${input.organizationId}, ${input.email.toLowerCase()}, ${input.tokenHash}, ${input.expiresAt}, ${input.createdBy})
    RETURNING id, organization_id, email, expires_at, created_at
  `,
  );
}

export async function getByTokenHash(tokenHash: Buffer) {
  return platformDb.maybeOne<{
    id: string;
    organizationId: string;
    email: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  }>(
    'health-check',
    'validate admin invitation',
    sql`
    SELECT id, organization_id, email, expires_at, accepted_at, revoked_at
    FROM admin_invitation WHERE token_hash = ${tokenHash}
  `,
  );
}

export async function markAccepted(id: string): Promise<void> {
  await platformDb.query(
    'organization-provisioning',
    'accept company admin invitation',
    sql`UPDATE admin_invitation SET accepted_at = now() WHERE id = ${id} AND accepted_at IS NULL AND revoked_at IS NULL`,
  );
}

export async function getLatestPending(organizationId: string, email: string) {
  return platformDb.maybeOne<{ id: string; expiresAt: Date }>(
    'health-check',
    'find pending admin invitation',
    sql`
    SELECT id, expires_at FROM admin_invitation WHERE organization_id = ${organizationId} AND email = ${email.toLowerCase()}
      AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1
  `,
  );
}

export interface InvitationListRow {
  id: string;
  organizationId: string;
  companyName: string;
  companyCode: string;
  companyStatus: 'active' | 'suspended';
  adminName: string;
  adminEmail: string;
  status: 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | 'PENDING';
  createdAt: Date;
  expiresAt: Date;
  lastSentAt: Date;
  resendCount: number;
}

export async function listAll(input: {
  page: number;
  limit: number;
  search?: string;
  status?: InvitationListRow['status'];
}) {
  const search = input.search?.trim() ?? '';
  const searchFilter = search
    ? sql`AND (o.name ILIKE ${`%${search}%`} OR o.code ILIKE ${`%${search}%`} OR i.email ILIKE ${`%${search}%`})`
    : sql``;
  const statusFilter = input.status
    ? sql`AND CASE
        WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'
        WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
        WHEN i.expires_at <= now() THEN 'EXPIRED'
        ELSE 'PENDING'
      END = ${input.status}`
    : sql``;
  const offset = (input.page - 1) * input.limit;

  return platformDb.transaction(
    'health-check',
    'list company admin invitations',
    async (tx) => {
      const count = await tx.one<{ totalCount: number }>(sql`
        SELECT count(*)::int AS total_count
        FROM admin_invitation i
        JOIN organization o ON o.id = i.organization_id
        WHERE true ${searchFilter} ${statusFilter}
      `);
      const items = await tx.query<InvitationListRow>(sql`
        SELECT
          i.id,
          i.organization_id,
          o.name AS company_name,
          o.code AS company_code,
          o.status AS company_status,
          o.owner_full_name AS admin_name,
          i.email AS admin_email,
          CASE
            WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'
            WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
            WHEN i.expires_at <= now() THEN 'EXPIRED'
            ELSE 'PENDING'
          END AS status,
          i.created_at,
          i.expires_at,
          i.last_sent_at,
          i.resend_count
        FROM admin_invitation i
        JOIN organization o ON o.id = i.organization_id
        WHERE true ${searchFilter} ${statusFilter}
        ORDER BY i.created_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `);
      return { items, totalCount: count.totalCount };
    },
  );
}

export async function revoke(id: string) {
  return platformDb.maybeOne<{ id: string }>(
    'organization-provisioning',
    'revoke company admin invitation',
    sql`
      UPDATE admin_invitation
      SET revoked_at = now()
      WHERE id = ${id}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING id
    `,
  );
}
