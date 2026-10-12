import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type {
  Deal,
  DealApprovalStatus,
  DealContractStatus,
  DealLifecycleStatus,
  DealLossReason,
  DealPaymentStatus,
  DealResource,
  DealStage,
} from './types.js';

interface DealRow {
  readonly id: string;
  readonly organizationId: string;
  readonly dealNumber: string;
  readonly originatingLeadId: string | null;
  readonly directEntryReason: string | null;
  readonly contactId: string;
  readonly contactName: string | null;
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly serviceRequested: string | null;
  readonly title: string;
  readonly scopeSummary: string | null;
  readonly originatingAgentId: string;
  readonly originatingAgentName: string | null;
  readonly responsibleCloserId: string;
  readonly responsibleCloserName: string | null;
  readonly closedById: string | null;
  readonly currency: string;
  readonly expectedCloseAt: Date | null;
  readonly probabilityOverride: string | null;      // numeric → string from pg
  readonly commercialsId: string | null;
  readonly dealStage: DealStage;
  readonly approvalStatus: DealApprovalStatus;
  readonly contractStatus: DealContractStatus;
  readonly paymentStatus: DealPaymentStatus;
  readonly lifecycleStatus: DealLifecycleStatus;
  readonly lossReason: DealLossReason | null;
  readonly lostAt: Date | null;
  readonly wonAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const DEAL_SELECT = sql`
  SELECT d.id,
         d.organization_id          AS "organizationId",
         d.deal_number::text        AS "dealNumber",
         d.originating_lead_id      AS "originatingLeadId",
         d.direct_entry_reason      AS "directEntryReason",
         d.contact_id               AS "contactId",
         contact.full_name          AS "contactName",
         d.company_id               AS "companyId",
         company.name               AS "companyName",
         d.service_requested        AS "serviceRequested",
         d.title,
         d.scope_summary            AS "scopeSummary",
         d.originating_agent_id     AS "originatingAgentId",
         orig.full_name             AS "originatingAgentName",
         d.responsible_closer_id    AS "responsibleCloserId",
         closer.full_name           AS "responsibleCloserName",
         d.closed_by_id             AS "closedById",
         d.currency,
         d.expected_close_at        AS "expectedCloseAt",
         d.probability_override     AS "probabilityOverride",
         d.commercials_id           AS "commercialsId",
         d.deal_stage               AS "dealStage",
         d.approval_status          AS "approvalStatus",
         d.contract_status          AS "contractStatus",
         d.payment_status           AS "paymentStatus",
         d.lifecycle_status         AS "lifecycleStatus",
         d.loss_reason              AS "lossReason",
         d.lost_at                  AS "lostAt",
         d.won_at                   AS "wonAt",
         d.cancelled_at             AS "cancelledAt",
         d.created_by               AS "createdBy",
         d.created_at               AS "createdAt",
         d.updated_at               AS "updatedAt"
    FROM deal d
    JOIN contact contact ON contact.organization_id = d.organization_id AND contact.id = d.contact_id
    LEFT JOIN company company ON company.organization_id = d.organization_id AND company.id = d.company_id
    JOIN app_user orig  ON orig.organization_id   = d.organization_id AND orig.id   = d.originating_agent_id
    JOIN app_user closer ON closer.organization_id = d.organization_id AND closer.id = d.responsible_closer_id
`;

function toDeal(row: DealRow): Deal {
  return {
    ...row,
    probabilityOverride: row.probabilityOverride === null ? null : Number(row.probabilityOverride),
  };
}

export interface DealListFilter {
  readonly stage?: DealStage;
  readonly lifecycleStatus?: DealLifecycleStatus;
  readonly responsibleCloserId?: string;
  readonly expectedCloseBefore?: Date;
  readonly expectedCloseAfter?: Date;
  readonly search?: string;
}

export interface DealPage {
  readonly items: readonly Deal[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export async function listDealsRows(
  ctx: RequestContext,
  scope: SqlFragment,
  filter: DealListFilter,
  page: number,
  pageSize: number,
): Promise<DealPage> {
  const filters: SqlFragment[] = [scope];
  if (filter.stage) filters.push(sql`d.deal_stage = ${filter.stage}`);
  if (filter.lifecycleStatus) filters.push(sql`d.lifecycle_status = ${filter.lifecycleStatus}`);
  if (filter.responsibleCloserId) filters.push(sql`d.responsible_closer_id = ${filter.responsibleCloserId}`);
  if (filter.expectedCloseBefore) filters.push(sql`d.expected_close_at < ${filter.expectedCloseBefore}`);
  if (filter.expectedCloseAfter) filters.push(sql`d.expected_close_at >= ${filter.expectedCloseAfter}`);
  if (filter.search) {
    const search = `%${filter.search}%`;
    filters.push(sql`(d.title ILIKE ${search} OR contact.full_name ILIKE ${search} OR company.name ILIKE ${search})`);
  }
  const where = sql.join(filters, ' AND ');

  const count = await db.one<{ total: string }>(
    ctx,
    sql`SELECT count(*)::text AS total FROM deal d
          JOIN contact contact ON contact.organization_id = d.organization_id AND contact.id = d.contact_id
          LEFT JOIN company company ON company.organization_id = d.organization_id AND company.id = d.company_id
         WHERE d.organization_id = ${ctx.organizationId} AND ${where}`,
  );
  const offset = (page - 1) * pageSize;
  const rows = await db.query<DealRow>(
    ctx,
    sql`${DEAL_SELECT}
         WHERE d.organization_id = ${ctx.organizationId} AND ${where}
         ORDER BY d.updated_at DESC, d.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
  );
  const total = Number(count.total);
  return {
    items: rows.map(toDeal),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function findDeal(ctx: RequestContext, id: string): Promise<Deal | null> {
  const row = await db.maybeOne<DealRow>(ctx, sql`${DEAL_SELECT} WHERE d.organization_id = ${ctx.organizationId} AND d.id = ${id}`);
  return row ? toDeal(row) : null;
}

export async function findDealTx(tx: Tx, organizationId: string, id: string): Promise<Deal | null> {
  const row = await tx.maybeOne<DealRow>(sql`${DEAL_SELECT} WHERE d.organization_id = ${organizationId} AND d.id = ${id}`);
  return row ? toDeal(row) : null;
}

export async function lockDeal(tx: Tx, organizationId: string, id: string): Promise<{
  readonly id: string;
  readonly dealStage: DealStage;
  readonly lifecycleStatus: DealLifecycleStatus;
  readonly responsibleCloserId: string;
  readonly originatingAgentId: string;
} | null> {
  return tx.maybeOne(sql`
    SELECT id,
           deal_stage           AS "dealStage",
           lifecycle_status     AS "lifecycleStatus",
           responsible_closer_id AS "responsibleCloserId",
           originating_agent_id  AS "originatingAgentId"
      FROM deal
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
     FOR UPDATE
  `);
}

export async function loadDealResource(ctx: RequestContext, id: string): Promise<DealResource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    responsibleCloserId: string;
    originatingAgentId: string;
    lifecycleStatus: DealLifecycleStatus;
  }>(
    ctx,
    sql`SELECT id,
               organization_id       AS "organizationId",
               responsible_closer_id AS "responsibleCloserId",
               originating_agent_id  AS "originatingAgentId",
               lifecycle_status      AS "lifecycleStatus"
          FROM deal
         WHERE organization_id = ${ctx.organizationId} AND id = ${id}`,
  );
  return row ? { type: 'deal' as const, ...row } : null;
}

export interface InsertDealInput {
  readonly originatingLeadId: string | null;
  readonly directEntryReason: string | null;
  readonly contactId: string;
  readonly companyId: string | null;
  readonly serviceRequested: string | null;
  readonly title: string;
  readonly scopeSummary: string | null;
  readonly originatingAgentId: string;
  readonly responsibleCloserId: string;
  readonly currency: string;
  readonly expectedCloseAt: Date | null;
  readonly createdBy: string;
}

export async function insertDeal(tx: Tx, organizationId: string, input: InsertDealInput): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO deal (
      organization_id, originating_lead_id, direct_entry_reason, contact_id, company_id,
      service_requested, title, scope_summary,
      originating_agent_id, responsible_closer_id,
      currency, expected_close_at, created_by
    ) VALUES (
      ${organizationId}, ${input.originatingLeadId}, ${input.directEntryReason},
      ${input.contactId}, ${input.companyId},
      ${input.serviceRequested}, ${input.title}, ${input.scopeSummary},
      ${input.originatingAgentId}, ${input.responsibleCloserId},
      ${input.currency}, ${input.expectedCloseAt}, ${input.createdBy}
    )
    RETURNING id
  `);
  return row.id;
}

export async function updateDealStage(tx: Tx, organizationId: string, id: string, stage: DealStage): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET deal_stage = ${stage},
           updated_at = now()
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function updateProbabilityOverride(tx: Tx, organizationId: string, id: string, probability: number | null): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET probability_override = ${probability},
           updated_at           = now()
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markLostRow(tx: Tx, organizationId: string, id: string, reason: DealLossReason, now: Date): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET lifecycle_status = 'lost',
           loss_reason      = ${reason},
           lost_at          = ${now},
           updated_at       = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markCancelledRow(tx: Tx, organizationId: string, id: string, now: Date): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET lifecycle_status = 'cancelled',
           cancelled_at     = ${now},
           updated_at       = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

/**
 * Flip the deal to its won terminal state atomically (R-DEAL-03, R-WIN-01).
 * Must only be called from inside the Won recorder's locked transaction.
 */
export async function markWonRow(
  tx: Tx,
  organizationId: string,
  id: string,
  closedById: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET deal_stage       = 'closed',
           lifecycle_status = 'won',
           won_at           = ${now},
           closed_by_id     = ${closedById},
           updated_at       = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

/** Deal audit outbox write (mirrors leads/repository.ts insertAudit). */
export async function insertDealAudit(
  tx: Tx,
  ctx: RequestContext,
  action: string,
  dealId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'deal',
      targetId: dealId,
      before,
      after,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}
