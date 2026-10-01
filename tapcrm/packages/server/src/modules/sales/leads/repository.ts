import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { Campaign, DuplicateWarning, Lead, LeadActivity, LeadActivityEvent, LeadSource, LeadStatus } from './types.js';
import type { LeadListQuery, SourceInput, UpdateLeadInput, UpdateSourceInput } from './validators.js';

type SourceRow = LeadSource;
interface LeadRow extends Omit<Lead, 'activities' | 'createdAt' | 'updatedAt'> { createdAt: Date; updatedAt: Date; activities: LeadActivity[] | null; }

const LEAD_SELECT = sql`
  SELECT l.id, l.organization_id AS "organizationId", l.lead_number::text AS "leadNumber",
         l.owner_id AS "ownerId", owner.full_name AS "ownerName",
         l.current_holder_id AS "currentHolderId", holder.full_name AS "currentHolderName",
         l.territory_id AS "territoryId", territory.name AS "territoryName",
         l.sales_team_id AS "salesTeamId", team.name AS "salesTeamName",
         l.sales_pool_id AS "salesPoolId", pool.name AS "salesPoolName",
         l.source_id AS "sourceId", source.name AS "sourceName", source.direction AS "sourceDirection",
         l.campaign_id AS "campaignId", campaign.name AS "campaignName",
         l.status, l.routing_status AS "routingStatus", l.contact_name AS "contactName",
         l.company_name AS "companyName", l.phone, l.email::text AS email,
         l.loss_reason AS "lossReason", l.lost_at AS "lostAt", l.previous_lead_id AS "previousLeadId",
         l.stalled_at AS "stalledAt", l.stalled_reason AS "stalledReason",
         l.created_by AS "createdBy", l.created_at AS "createdAt", l.updated_at AS "updatedAt",
         COALESCE((SELECT json_agg(json_build_object('id', a.id, 'eventName', a.event_name, 'actorId', a.actor_id, 'metadata', a.metadata, 'createdAt', a.created_at) ORDER BY a.created_at)
                   FROM lead_activity a WHERE a.organization_id = l.organization_id AND a.lead_id = l.id), '[]'::json) AS activities
  FROM lead l
  LEFT JOIN app_user owner ON owner.organization_id = l.organization_id AND owner.id = l.owner_id
  LEFT JOIN app_user holder ON holder.organization_id = l.organization_id AND holder.id = l.current_holder_id
  LEFT JOIN sales_territories territory ON territory.organization_id = l.organization_id AND territory.id = l.territory_id
  LEFT JOIN team ON team.organization_id = l.organization_id AND team.id = l.sales_team_id
  LEFT JOIN team pool ON pool.organization_id = l.organization_id AND pool.id = l.sales_pool_id
  JOIN lead_source source ON source.organization_id = l.organization_id AND source.id = l.source_id
  LEFT JOIN campaign ON campaign.organization_id = l.organization_id AND campaign.id = l.campaign_id
`;

function mapLead(row: LeadRow): Lead { return { ...row, status: row.status, lostAt: row.lostAt ? new Date(row.lostAt) : null, stalledAt: row.stalledAt ? new Date(row.stalledAt) : null, activities: row.activities ?? [], createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }; }

export async function listSources(ctx: RequestContext): Promise<LeadSource[]> { return db.query<SourceRow>(ctx, sql`SELECT id, organization_id AS "organizationId", name, direction, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM lead_source WHERE organization_id = ${ctx.organizationId} ORDER BY name`); }
export async function findSource(tx: Tx, organizationId: string, id: string): Promise<LeadSource | null> { return tx.maybeOne<LeadSource>(sql`SELECT id, organization_id AS "organizationId", name, direction, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM lead_source WHERE organization_id = ${organizationId} AND id = ${id}`); }
export async function insertSource(tx: Tx, organizationId: string, input: SourceInput): Promise<LeadSource> { return tx.one<LeadSource>(sql`INSERT INTO lead_source (organization_id, name, direction, status) VALUES (${organizationId}, ${input.name}, ${input.direction}, ${input.status}) RETURNING id, organization_id AS "organizationId", name, direction, status, created_at AS "createdAt", updated_at AS "updatedAt"`); }
export async function updateSource(tx: Tx, organizationId: string, id: string, input: UpdateSourceInput): Promise<LeadSource> { return tx.one<LeadSource>(sql`UPDATE lead_source SET name = COALESCE(${input.name ?? null}, name), direction = COALESCE(${input.direction ?? null}, direction), status = COALESCE(${input.status ?? null}, status) WHERE organization_id = ${organizationId} AND id = ${id} RETURNING id, organization_id AS "organizationId", name, direction, status, created_at AS "createdAt", updated_at AS "updatedAt"`); }

export async function findCampaign(tx: Tx, organizationId: string, id: string): Promise<Campaign | null> { return tx.maybeOne<Campaign>(sql`SELECT id, organization_id AS "organizationId", name, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM campaign WHERE organization_id = ${organizationId} AND id = ${id}`); }
export async function listCampaigns(ctx: RequestContext): Promise<Campaign[]> { return db.query<Campaign>(ctx, sql`SELECT id, organization_id AS "organizationId", name, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM campaign WHERE organization_id = ${ctx.organizationId} ORDER BY name`); }

export async function listLeads(ctx: RequestContext, filter: SqlFragment, query: LeadListQuery): Promise<{ rows: Lead[]; total: number }> {
  const count = await db.one<{ total: string }>(ctx, sql`SELECT COUNT(*)::text AS total FROM lead l WHERE l.organization_id = ${ctx.organizationId} AND ${filter}`);
  const offset = (query.page - 1) * query.pageSize;
  const rows = await db.query<LeadRow>(ctx, sql`${LEAD_SELECT} WHERE l.organization_id = ${ctx.organizationId} AND ${filter} ORDER BY l.updated_at DESC, l.id DESC LIMIT ${query.pageSize} OFFSET ${offset}`);
  return { rows: rows.map(mapLead), total: Number(count.total) };
}
export async function findLead(ctx: RequestContext, id: string): Promise<Lead | null> { const row = await db.maybeOne<LeadRow>(ctx, sql`${LEAD_SELECT} WHERE l.organization_id = ${ctx.organizationId} AND l.id = ${id}`); return row ? mapLead(row) : null; }
export async function findLeadTx(tx: Tx, organizationId: string, id: string): Promise<Lead | null> { const row = await tx.maybeOne<LeadRow>(sql`${LEAD_SELECT} WHERE l.organization_id = ${organizationId} AND l.id = ${id}`); return row ? mapLead(row) : null; }
export async function loadLeadResource(ctx: RequestContext, id: string) { return db.maybeOne<{ id: string; organizationId: string; ownerId: string | null; currentHolderId: string | null; status: string; salesTeamId: string | null; salesPoolId: string | null; departmentId: string | null }>(ctx, sql`SELECT l.id, l.organization_id AS "organizationId", l.owner_id AS "ownerId", l.current_holder_id AS "currentHolderId", l.status, l.sales_team_id AS "salesTeamId", l.sales_pool_id AS "salesPoolId", team.department_id AS "departmentId" FROM lead l LEFT JOIN team ON team.organization_id = l.organization_id AND team.id = l.sales_team_id WHERE l.organization_id = ${ctx.organizationId} AND l.id = ${id}`).then((row) => row ? { type: 'lead' as const, ...row } : null); }

export async function findSourceTx(tx: Tx, organizationId: string, id: string): Promise<LeadSource | null> { return findSource(tx, organizationId, id); }
export async function insertLead(tx: Tx, organizationId: string, input: { sourceId: string; campaignId: string | null; previousLeadId: string | null; ownerId: string | null; currentHolderId: string | null; territoryId: string | null; salesTeamId: string | null; salesPoolId: string | null; status: LeadStatus; routingStatus: 'assigned' | 'unrouted'; contactName: string; companyName: string | null; phone: string | null; email: string | null; phoneNormalized: string | null; emailNormalized: string | null; createdBy: string }): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`INSERT INTO lead (organization_id, source_id, campaign_id, previous_lead_id, owner_id, current_holder_id, territory_id, sales_team_id, sales_pool_id, status, routing_status, contact_name, company_name, phone, email, phone_normalized, email_normalized, created_by) VALUES (${organizationId}, ${input.sourceId}, ${input.campaignId}, ${input.previousLeadId}, ${input.ownerId}, ${input.currentHolderId}, ${input.territoryId}, ${input.salesTeamId}, ${input.salesPoolId}, ${input.status}, ${input.routingStatus}, ${input.contactName}, ${input.companyName}, ${input.phone}, ${input.email}, ${input.phoneNormalized}, ${input.emailNormalized}, ${input.createdBy}) RETURNING id`);
  return row.id;
}
export async function updateLeadRow(tx: Tx, organizationId: string, id: string, input: UpdateLeadInput, before: Lead, normalized: { phone: string | null; email: string | null }): Promise<void> { await tx.query(sql`UPDATE lead SET contact_name = COALESCE(${input.contactName ?? null}, contact_name), company_name = ${input.companyName === undefined ? before.companyName : input.companyName}, phone = ${input.phone === undefined ? before.phone : input.phone}, email = ${input.email === undefined ? before.email : input.email}, phone_normalized = ${normalized.phone}, email_normalized = ${normalized.email}, campaign_id = ${input.campaignId === undefined ? before.campaignId : input.campaignId}, status = COALESCE(${input.status ?? null}, status) WHERE organization_id = ${organizationId} AND id = ${id}`); }
export async function insertActivity(tx: Tx, organizationId: string, leadId: string, eventName: LeadActivityEvent, actorId: string | null, metadata: unknown): Promise<void> { await tx.query(sql`INSERT INTO lead_activity (organization_id, lead_id, event_name, actor_id, metadata) VALUES (${organizationId}, ${leadId}, ${eventName}, ${actorId}, ${JSON.stringify(metadata)}::jsonb)`); }
export async function insertAudit(tx: Tx, ctx: RequestContext, action: string, targetId: string, before: unknown, after: unknown, targetType = 'lead'): Promise<void> { await tx.query(sql`INSERT INTO audit_outbox (organization_id, stream, payload) VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({ action, actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType, targetId, before, after, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)`); }

export async function findDuplicates(ctx: RequestContext, filter: SqlFragment, phone: string | null, email: string | null): Promise<DuplicateWarning[]> {
  if (!phone && !email) return [];
  const row = await db.query<{ leadId: string; leadNumber: string; ownerId: string | null; ownerName: string | null }>(ctx, sql`SELECT l.id AS "leadId", l.lead_number::text AS "leadNumber", l.owner_id AS "ownerId", owner.full_name AS "ownerName" FROM lead l LEFT JOIN app_user owner ON owner.organization_id = l.organization_id AND owner.id = l.owner_id WHERE l.organization_id = ${ctx.organizationId} AND ${filter} AND ((${phone} IS NOT NULL AND l.phone_normalized = ${phone}) OR (${email} IS NOT NULL AND l.email_normalized = ${email})) ORDER BY l.created_at DESC LIMIT 10`);
  return row;
}
export async function findDuplicatesTx(tx: Tx, organizationId: string, filter: SqlFragment, phone: string | null, email: string | null): Promise<DuplicateWarning[]> {
  if (!phone && !email) return [];
  return tx.query<DuplicateWarning>(sql`SELECT l.id AS "leadId", l.lead_number::text AS "leadNumber", l.owner_id AS "ownerId", owner.full_name AS "ownerName" FROM lead l LEFT JOIN app_user owner ON owner.organization_id = l.organization_id AND owner.id = l.owner_id WHERE l.organization_id = ${organizationId} AND ${filter} AND ((${phone} IS NOT NULL AND l.phone_normalized = ${phone}) OR (${email} IS NOT NULL AND l.email_normalized = ${email})) ORDER BY l.created_at DESC LIMIT 10`);
}
