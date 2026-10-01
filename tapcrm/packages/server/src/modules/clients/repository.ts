import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { Client, ClientListQuery, ClientRegion, ClientStatus, ClientSummary, PaginatedClients } from './types.js';

interface ClientRow {
  id: string;
  organizationId: string;
  clientName: string;
  businessName: string;
  email: string;
  region: ClientRegion;
  currency: string;
  timezone: string;
  status: ClientStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  hasActiveLogin: boolean;
  loginUserId: string | null;
}

const SELECT_CLIENT = sql`
  SELECT c.id, c.organization_id, c.client_name, c.business_name, c.email, c.region, c.currency, c.timezone,
         c.status, c.created_by, c.created_at, c.updated_at,
         (login.id IS NOT NULL) AS "hasActiveLogin",
         login.id AS "loginUserId"
  FROM client c
  LEFT JOIN app_user login
    ON login.organization_id = c.organization_id AND login.client_id = c.id AND login.status = 'active'
`;

const toClient = (row: ClientRow): Client => row;

/** Boundary rule (§3): a module may not import another module's repository, so this is a local, deliberately duplicated check. */
export async function emailExists(tx: Tx, email: string): Promise<boolean> {
  const row = await tx.maybeOne<{ email: string }>(sql`SELECT email FROM identity_email_directory WHERE email = ${email}`);
  return row !== null;
}

export async function clientEmailExists(ctx: RequestContext, email: string, excludeClientId?: string): Promise<boolean> {
  const row = await db.maybeOne<{ id: string }>(ctx, sql`
    SELECT id FROM client
    WHERE organization_id = ${ctx.organizationId} AND email = ${email}
      AND (${excludeClientId ?? null}::uuid IS NULL OR id <> ${excludeClientId ?? null}::uuid)
  `);
  return row !== null;
}

export async function listClients(ctx: RequestContext, filter: SqlFragment, query: ClientListQuery): Promise<PaginatedClients> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const search = query.search?.trim();
  const statusClause = query.status && query.status !== 'all' ? sql`AND c.status = ${query.status}` : sql``;
  const searchClause = search
    ? sql`AND (c.client_name ILIKE ${`%${search}%`} OR c.business_name ILIKE ${`%${search}%`} OR c.email::text ILIKE ${`%${search}%`})`
    : sql``;

  const [items, totalRow] = await Promise.all([
    db.query<ClientRow>(ctx, sql`
      ${SELECT_CLIENT}
      WHERE c.organization_id = ${ctx.organizationId} AND (${filter})
      ${statusClause} ${searchClause}
      ORDER BY c.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.one<{ count: string }>(ctx, sql`
      SELECT count(*)::text AS count FROM client c
      WHERE c.organization_id = ${ctx.organizationId} AND (${filter})
      ${statusClause} ${searchClause}
    `),
  ]);

  const total = Number(totalRow.count);
  return { items: items.map(toClient), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function findClientById(ctx: RequestContext, id: string): Promise<Client | null> {
  const row = await db.maybeOne<ClientRow>(ctx, sql`${SELECT_CLIENT} WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${id}`);
  return row ? toClient(row) : null;
}

/** For the policy's `check()` (object-level, via `loadResource`): who is assigned to a project for this client. */
export async function findClientProjectAssigneeIds(ctx: RequestContext, id: string): Promise<string[]> {
  const rows = await db.query<{ userId: string }>(ctx, sql`
    SELECT DISTINCT pa.user_id AS "userId"
    FROM project p
    JOIN project_assignee pa ON pa.organization_id = p.organization_id AND pa.project_id = p.id
    WHERE p.organization_id = ${ctx.organizationId} AND p.client_id = ${id}
  `);
  return rows.map((r) => r.userId);
}

/** For the projects module (business-name autofill, currency snapshot) — never imported directly; see clients/facade.ts. */
export async function findClientSummary(tx: Tx, organizationId: string, id: string): Promise<ClientSummary | null> {
  return tx.maybeOne<ClientSummary>(sql`
    SELECT id, client_name AS "clientName", business_name AS "businessName", currency, status
    FROM client WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function insertClient(
  tx: Tx,
  organizationId: string,
  createdBy: string,
  input: { clientName: string; businessName: string; email: string; region: ClientRegion; currency: string; timezone: string },
): Promise<{ id: string }> {
  return tx.one<{ id: string }>(sql`
    INSERT INTO client (organization_id, client_name, business_name, email, region, currency, timezone, created_by)
    VALUES (${organizationId}, ${input.clientName}, ${input.businessName}, ${input.email}, ${input.region}, ${input.currency}, ${input.timezone}, ${createdBy})
    RETURNING id
  `);
}

export async function updateClientRow(
  tx: Tx,
  organizationId: string,
  id: string,
  input: { clientName?: string; businessName?: string; region?: ClientRegion; currency?: string; timezone?: string; status?: ClientStatus },
): Promise<void> {
  await tx.query(sql`
    UPDATE client SET
      client_name = COALESCE(${input.clientName ?? null}, client_name),
      business_name = COALESCE(${input.businessName ?? null}, business_name),
      region = COALESCE(${input.region ?? null}, region),
      currency = COALESCE(${input.currency ?? null}, currency),
      timezone = COALESCE(${input.timezone ?? null}, timezone),
      status = COALESCE(${input.status ?? null}, status),
      updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function findClientLoginUserId(ctx: RequestContext, clientId: string): Promise<string | null> {
  const row = await db.maybeOne<{ id: string }>(ctx, sql`
    SELECT id FROM app_user WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND account_type = 'client'
  `);
  return row?.id ?? null;
}

/** Same query, participating in a caller's open transaction (see setClientCredentials's update-or-insert decision). */
export async function findClientLoginUserIdTx(tx: Tx, organizationId: string, clientId: string): Promise<string | null> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM app_user WHERE organization_id = ${organizationId} AND client_id = ${clientId} AND account_type = 'client'
  `);
  return row?.id ?? null;
}

export async function insertClientLogin(
  tx: Tx,
  organizationId: string,
  clientId: string,
  input: { email: string; passwordHash: string; fullName: string },
): Promise<{ id: string }> {
  return tx.one<{ id: string }>(sql`
    INSERT INTO app_user (organization_id, account_type, client_id, email, password_hash, full_name, status, email_verified_at, must_change_password)
    VALUES (${organizationId}, 'client', ${clientId}, ${input.email}, ${input.passwordHash}, ${input.fullName}, 'active', now(), false)
    RETURNING id
  `);
}

export async function resetClientLoginPassword(tx: Tx, organizationId: string, userId: string, passwordHash: string): Promise<void> {
  await tx.query(sql`
    UPDATE app_user SET password_hash = ${passwordHash}, session_version = session_version + 1
    WHERE organization_id = ${organizationId} AND id = ${userId}
  `);
}

/** "Delete credentials" = revoke the login (ID-7 pattern: bump session_version, deactivate). The client record itself is untouched. */
export async function deactivateClientLogin(tx: Tx, organizationId: string, userId: string): Promise<void> {
  await tx.query(sql`
    UPDATE app_user SET status = 'inactive', session_version = session_version + 1
    WHERE organization_id = ${organizationId} AND id = ${userId}
  `);
}
