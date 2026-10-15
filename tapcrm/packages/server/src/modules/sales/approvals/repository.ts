/**
 * Sales v1.1 R2 — Approval repository (R2 plan step 2.11).
 */

import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type {
  ActorAuthority,
  ApprovalDecision,
  ApprovalDimension,
  ApprovalRequest,
  ApprovalResource,
  ApprovalState,
  ApprovalVerdict,
} from './types.js';

interface RequestRow {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly dimensions: readonly ApprovalDimension[];
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly currentApproverId: string | null;
  readonly slaDueAt: Date;
  readonly escalationCount: number;
  readonly state: ApprovalState;
  readonly blockedReason: string | null;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
}

function toRequest(row: RequestRow): ApprovalRequest {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dealId: row.dealId,
    commercialsId: row.commercialsId,
    dimensions: row.dimensions,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    currentApproverId: row.currentApproverId,
    slaDueAt: row.slaDueAt,
    escalationCount: row.escalationCount,
    state: row.state,
    blockedReason: row.blockedReason,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
  };
}

const REQUEST_SELECT = sql`
  SELECT id,
         organization_id      AS "organizationId",
         deal_id              AS "dealId",
         commercials_id       AS "commercialsId",
         dimensions,
         requested_by         AS "requestedBy",
         requested_at         AS "requestedAt",
         current_approver_id  AS "currentApproverId",
         sla_due_at           AS "slaDueAt",
         escalation_count     AS "escalationCount",
         state,
         blocked_reason       AS "blockedReason",
         decided_at           AS "decidedAt",
         decided_by           AS "decidedBy"
    FROM approval_request
`;

export async function findRequest(ctx: RequestContext, id: string): Promise<ApprovalRequest | null> {
  const row = await db.maybeOne<RequestRow>(
    ctx,
    sql`${REQUEST_SELECT} WHERE organization_id = ${ctx.organizationId} AND id = ${id}`,
  );
  return row ? toRequest(row) : null;
}

export async function loadApprovalResource(ctx: RequestContext, id: string): Promise<ApprovalResource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    dealId: string;
    requestedBy: string;
    currentApproverId: string | null;
    state: ApprovalState;
  }>(
    ctx,
    sql`SELECT id,
               organization_id     AS "organizationId",
               deal_id             AS "dealId",
               requested_by        AS "requestedBy",
               current_approver_id AS "currentApproverId",
               state
          FROM approval_request
         WHERE organization_id = ${ctx.organizationId} AND id = ${id}`,
  );
  return row ? { type: 'approvalRequest' as const, ...row } : null;
}

export async function lockRequest(tx: Tx, organizationId: string, id: string): Promise<ApprovalRequest | null> {
  const row = await tx.maybeOne<RequestRow>(
    sql`${REQUEST_SELECT} WHERE organization_id = ${organizationId} AND id = ${id} FOR UPDATE`,
  );
  return row ? toRequest(row) : null;
}

export async function findPendingForDeal(ctx: RequestContext, dealId: string): Promise<ApprovalRequest | null> {
  const row = await db.maybeOne<RequestRow>(
    ctx,
    sql`${REQUEST_SELECT}
         WHERE organization_id = ${ctx.organizationId}
           AND deal_id         = ${dealId}
           AND state IN ('pending','escalated','returned')
         ORDER BY requested_at DESC
         LIMIT 1`,
  );
  return row ? toRequest(row) : null;
}

export async function findPendingForDealTx(tx: Tx, organizationId: string, dealId: string): Promise<ApprovalRequest | null> {
  const row = await tx.maybeOne<RequestRow>(
    sql`${REQUEST_SELECT}
         WHERE organization_id = ${organizationId}
           AND deal_id         = ${dealId}
           AND state IN ('pending','escalated','returned')
         ORDER BY requested_at DESC
         LIMIT 1
         FOR UPDATE`,
  );
  return row ? toRequest(row) : null;
}

export async function listPendingForApprover(ctx: RequestContext, approverId: string): Promise<readonly ApprovalRequest[]> {
  const rows = await db.query<RequestRow>(
    ctx,
    sql`${REQUEST_SELECT}
         WHERE organization_id = ${ctx.organizationId}
           AND current_approver_id = ${approverId}
           AND state IN ('pending','escalated','returned')
         ORDER BY sla_due_at ASC`,
  );
  return rows.map(toRequest);
}

export async function listPendingWithScope(
  ctx: RequestContext,
  scope: SqlFragment,
): Promise<readonly ApprovalRequest[]> {
  const rows = await db.query<RequestRow>(
    ctx,
    sql`${REQUEST_SELECT}
         WHERE organization_id = ${ctx.organizationId}
           AND state IN ('pending','escalated','returned')
           AND ${scope}
         ORDER BY sla_due_at ASC`,
  );
  return rows.map(toRequest);
}

export interface InsertRequestInput {
  readonly dealId: string;
  readonly commercialsId: string;
  readonly dimensions: readonly ApprovalDimension[];
  readonly requestedBy: string;
  readonly currentApproverId: string | null;
  readonly slaDueAt: Date;
  readonly blockedReason: string | null;
}

export async function insertRequest(tx: Tx, organizationId: string, input: InsertRequestInput): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO approval_request (
      organization_id, deal_id, commercials_id, dimensions,
      requested_by, current_approver_id, sla_due_at, blocked_reason
    ) VALUES (
      ${organizationId}, ${input.dealId}, ${input.commercialsId},
      ${JSON.stringify(input.dimensions)}::jsonb,
      ${input.requestedBy}, ${input.currentApproverId}, ${input.slaDueAt}, ${input.blockedReason}
    )
    RETURNING id
  `);
  return row.id;
}

export async function updateRequestState(
  tx: Tx,
  organizationId: string,
  id: string,
  input: {
    state: ApprovalState;
    decidedAt?: Date;
    decidedBy?: string;
    blockedReason?: string | null;
    currentApproverId?: string | null;
    slaDueAt?: Date;
    escalationCount?: number;
  },
): Promise<void> {
  await tx.query(sql`
    UPDATE approval_request
       SET state                = ${input.state},
           decided_at           = COALESCE(${input.decidedAt ?? null}, decided_at),
           decided_by           = COALESCE(${input.decidedBy ?? null}, decided_by),
           blocked_reason       = ${input.blockedReason ?? null},
           current_approver_id  = COALESCE(${input.currentApproverId ?? null}, current_approver_id),
           sla_due_at           = COALESCE(${input.slaDueAt ?? null}, sla_due_at),
           escalation_count     = COALESCE(${input.escalationCount ?? null}, escalation_count),
           updated_at           = now()
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function insertDecision(
  tx: Tx,
  organizationId: string,
  requestId: string,
  actorId: string,
  verdict: ApprovalVerdict,
  comment: string | null,
  decidedAt: Date,
): Promise<ApprovalDecision> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO approval_decision (
      organization_id, request_id, actor_id, verdict, comment, decided_at
    ) VALUES (
      ${organizationId}, ${requestId}, ${actorId}, ${verdict}, ${comment}, ${decidedAt}
    )
    RETURNING id
  `);
  return {
    id: row.id,
    requestId,
    actorId,
    verdict,
    comment,
    decidedAt,
  };
}

export async function updateDealApprovalStatus(
  tx: Tx,
  organizationId: string,
  dealId: string,
  status: 'not_required' | 'pending' | 'approved' | 'rejected',
): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET approval_status = ${status},
           updated_at      = now()
     WHERE organization_id = ${organizationId}
       AND id              = ${dealId}
  `);
}

export async function invalidateAllPendingForDeal(
  tx: Tx,
  organizationId: string,
  dealId: string,
  now: Date,
): Promise<readonly string[]> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE approval_request
       SET state          = 'invalidated',
           blocked_reason  = 'commercials_changed',
           updated_at      = ${now}
     WHERE organization_id = ${organizationId}
       AND deal_id         = ${dealId}
       AND state IN ('pending','escalated','returned')
     RETURNING id
  `);
  return rows.map((r) => r.id);
}

export async function insertApprovalAudit(
  tx: Tx,
  ctx: RequestContext,
  action: string,
  requestId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'approvalRequest',
      targetId: requestId,
      before,
      after,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}

export interface UserAuthorityRow {
  readonly userId: string;
  readonly reportsTo: string | null;
  readonly maxValueMinor: bigint | null;
  readonly maxDiscountBps: number | null;
  readonly minAdvanceBps: number | null;
  readonly allowsCustomTerms: boolean;
}

/**
 * Load a user's effective authority from their position. `maxDealValue`
 * is stored on `position` as `numeric` rupees; we convert to paise bigint
 * at the boundary. `maxDiscountPercent` is percent-of-100; convert to bps.
 */
export async function loadUserAuthority(ctx: RequestContext, userId: string): Promise<UserAuthorityRow | null> {
  const row = await db.maybeOne<{
    userId: string;
    reportsTo: string | null;
    maxDealValueRupees: string | null;
    maxDiscountPercent: string | null;
    allowsCustomTerms: boolean | null;
  }>(
    ctx,
    sql`SELECT u.id                   AS "userId",
               u.reports_to           AS "reportsTo",
               p.max_deal_value       AS "maxDealValueRupees",
               p.max_discount_percent AS "maxDiscountPercent",
               p.allows_custom_terms  AS "allowsCustomTerms"
          FROM app_user u
          LEFT JOIN position p
            ON p.organization_id = u.organization_id
           AND p.id              = u.position_id
         WHERE u.organization_id = ${ctx.organizationId}
           AND u.id              = ${userId}`,
  );
  if (!row) return null;
  return {
    userId: row.userId,
    reportsTo: row.reportsTo,
    maxValueMinor: row.maxDealValueRupees === null ? null : BigInt(Math.trunc(Number(row.maxDealValueRupees) * 100)),
    maxDiscountBps: row.maxDiscountPercent === null ? null : Math.round(Number(row.maxDiscountPercent) * 100),
    minAdvanceBps: null,
    allowsCustomTerms: row.allowsCustomTerms ?? false,
  };
}

export function toActorAuthority(row: UserAuthorityRow): ActorAuthority {
  return {
    maxValueMinor: row.maxValueMinor,
    maxDiscountBps: row.maxDiscountBps,
    minAdvanceBps: row.minAdvanceBps,
    allowsCustomTerms: row.allowsCustomTerms,
  };
}
