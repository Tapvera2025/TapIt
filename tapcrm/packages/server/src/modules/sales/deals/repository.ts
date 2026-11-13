import { effectivePolicy, scopeReachesAny, type SqlFragment } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { scopeResolver } from '../../../platform/authz-adapter.js';
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

/** The deal columns the authorization engine reads. */
export interface DealResourceRow {
  readonly id: string;
  readonly organizationId: string;
  readonly responsibleCloserId: string;
  readonly originatingAgentId: string;
  readonly lifecycleStatus: string;
  readonly createdBy: string | null;
  readonly closedBy: string | null;
  readonly paymentInitiatedBy: string | null;
}

/**
 * P1 (PRD §4.7): a deal's commercials are readable by the closer and the
 * approval chain. The approval chain is the closer's reporting line, the same
 * `reports_to` walk approvals/routing.ts uses to find an approver, with the
 * same depth limit and cycle guard. True when the caller sits above any of
 * the given closers.
 */
export async function isInClosingChain(ctx: RequestContext, closerIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(closerIds)];
  if (ids.length === 0) return false;
  const row = await db.one<{ inChain: boolean }>(
    ctx,
    sql`WITH RECURSIVE chain AS (
          SELECT u.id, u.reports_to AS "reportsTo", 0 AS depth, ARRAY[u.id] AS path
            FROM app_user u
           WHERE u.organization_id = ${ctx.organizationId}
             AND u.id = ANY(${ids}::uuid[])
          UNION ALL
          SELECT manager.id, manager.reports_to, chain.depth + 1, chain.path || manager.id
            FROM app_user manager
            JOIN chain ON chain."reportsTo" = manager.id
           WHERE manager.organization_id = ${ctx.organizationId}
             AND chain.depth < 10
             AND NOT manager.id = ANY(chain.path)
        )
        SELECT EXISTS (
          SELECT 1 FROM chain WHERE chain.depth > 0 AND chain.id = ${ctx.principal.id}
        ) AS "inChain"`,
  );
  return row.inChain;
}

/**
 * P1's approval chain also counts the managers who decide approvals over the
 * closer: a Supervisor, Team Lead or Sales Head whose `approvals:decide`
 * reach (pool, team or department) includes the closer. Every proposal from
 * the sales team now goes to approval, and an approver has to read the price
 * to judge it. The `reports_to` walk alone left out every manager when the
 * reporting line was never filled in, so the deal page told the Supervisor to
 * ask an admin while the admin's page said it was the Supervisor's move.
 * An agent decides nothing (its cell is `participant`), so a peer agent
 * still cannot read a colleague's closing terms.
 */
export async function approverReachesCloser(ctx: RequestContext, closerIds: readonly string[]): Promise<boolean> {
  const policy = await effectivePolicy(ctx, 'approvals:decide');
  if (!policy?.allowed) return false;
  if (policy.scope !== 'pool' && policy.scope !== 'team' && policy.scope !== 'department') return false;
  return scopeReachesAny({ ...ctx, scope: scopeResolver }, policy.scope, closerIds);
}

/**
 * The deal as the authorization engine sees it. Every loader that hands a
 * deal to the engine (the deal itself, its commercials, its contract) builds
 * it here, so P1 always has the approval chain resolved.
 */
export async function toDealResource(ctx: RequestContext, row: DealResourceRow): Promise<DealResource> {
  const closers = row.closedBy ? [row.responsibleCloserId, row.closedBy] : [row.responsibleCloserId];
  // A closer passes P1 on their own, and P1 never applies to a Super Admin;
  // only someone else needs the chain walk.
  const inChain = closers.includes(ctx.principal.id) || globalAccess(ctx.principal)
    ? false
    : (await isInClosingChain(ctx, closers)) || (await approverReachesCloser(ctx, closers));
  return {
    type: 'deal' as const,
    id: row.id,
    organizationId: row.organizationId,
    responsibleCloserId: row.responsibleCloserId,
    originatingAgentId: row.originatingAgentId,
    lifecycleStatus: row.lifecycleStatus as DealLifecycleStatus,
    createdBy: row.createdBy,
    closedBy: row.closedBy,
    payment: { initiatedBy: row.paymentInitiatedBy },
    __holderInClosingChain: inChain,
  };
}

export async function loadDealResource(ctx: RequestContext, id: string): Promise<DealResource | null> {
  const row = await db.maybeOne<DealResourceRow>(
    ctx,
    sql`SELECT id,
               organization_id       AS "organizationId",
               responsible_closer_id AS "responsibleCloserId",
               originating_agent_id  AS "originatingAgentId",
               lifecycle_status      AS "lifecycleStatus",
               created_by            AS "createdBy",
               closed_by_id          AS "closedBy",
               payment_initiated_by  AS "paymentInitiatedBy"
          FROM deal
         WHERE organization_id = ${ctx.organizationId} AND id = ${id}`,
  );
  if (!row) return null;
  return toDealResource(ctx, row);
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

export async function updatePaymentStatusRow(
  tx: Tx,
  organizationId: string,
  id: string,
  nextStatus: DealPaymentStatus,
  now: Date,
  initiatedBy: string | null = null,
): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET payment_status       = ${nextStatus},
           payment_initiated_by = ${initiatedBy},
           updated_at           = ${now}
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
