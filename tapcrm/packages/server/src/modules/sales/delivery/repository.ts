/**
 * Sales v1.1 R2 — Delivery brief repository (R2 plan step 2.15).
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { DeliveryBrief, DeliveryBriefContent, DeliveryBriefState } from './types.js';

interface BriefRow {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly state: DeliveryBriefState;
  readonly content: DeliveryBriefContent;
  readonly projectId: string | null;
  readonly submittedAt: Date | null;
  readonly reviewedAt: Date | null;
  readonly reviewedBy: string | null;
  readonly acceptedAt: Date | null;
  readonly acceptedBy: string | null;
  readonly cancelledAt: Date | null;
  readonly cancelledReason: string | null;
  readonly changeNotes: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const BRIEF_SELECT = sql`
  SELECT b.id,
         b.organization_id   AS "organizationId",
         b.deal_id           AS "dealId",
         b.commercials_id    AS "commercialsId",
         b.state,
         b.content,
         b.project_id        AS "projectId",
         b.submitted_at      AS "submittedAt",
         b.reviewed_at       AS "reviewedAt",
         b.reviewed_by       AS "reviewedBy",
         b.accepted_at       AS "acceptedAt",
         b.accepted_by       AS "acceptedBy",
         b.cancelled_at      AS "cancelledAt",
         b.cancelled_reason  AS "cancelledReason",
         b.change_notes      AS "changeNotes",
         b.created_by        AS "createdBy",
         b.created_at        AS "createdAt",
         b.updated_at        AS "updatedAt"
    FROM delivery_brief b
`;

export async function findBrief(ctx: RequestContext, id: string): Promise<DeliveryBrief | null> {
  return db.maybeOne<BriefRow>(
    ctx,
    sql`${BRIEF_SELECT} WHERE b.organization_id = ${ctx.organizationId} AND b.id = ${id}`,
  );
}

export async function findBriefTx(tx: Tx, organizationId: string, id: string): Promise<DeliveryBrief | null> {
  return tx.maybeOne<BriefRow>(
    sql`${BRIEF_SELECT} WHERE b.organization_id = ${organizationId} AND b.id = ${id}`,
  );
}

export async function findBriefForDeal(ctx: RequestContext, dealId: string): Promise<DeliveryBrief | null> {
  return db.maybeOne<BriefRow>(
    ctx,
    sql`${BRIEF_SELECT} WHERE b.organization_id = ${ctx.organizationId} AND b.deal_id = ${dealId}`,
  );
}

export async function findBriefForDealTx(tx: Tx, organizationId: string, dealId: string): Promise<DeliveryBrief | null> {
  return tx.maybeOne<BriefRow>(
    sql`${BRIEF_SELECT} WHERE b.organization_id = ${organizationId} AND b.deal_id = ${dealId}`,
  );
}

export interface LockedBrief {
  readonly id: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly state: DeliveryBriefState;
  readonly projectId: string | null;
  readonly acceptedAt: Date | null;
  readonly updatedAt: Date;
}

export async function lockBrief(tx: Tx, organizationId: string, id: string): Promise<LockedBrief | null> {
  return tx.maybeOne<LockedBrief>(sql`
    SELECT id,
           deal_id        AS "dealId",
           commercials_id AS "commercialsId",
           state,
           project_id     AS "projectId",
           accepted_at    AS "acceptedAt",
           updated_at     AS "updatedAt"
      FROM delivery_brief
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
     FOR UPDATE
  `);
}

export interface InsertBriefInput {
  readonly dealId: string;
  readonly commercialsId: string;
  readonly content: DeliveryBriefContent;
  readonly createdBy: string;
}

export async function insertBrief(
  tx: Tx,
  organizationId: string,
  input: InsertBriefInput,
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO delivery_brief (
      organization_id, deal_id, commercials_id, state, content, created_by
    ) VALUES (
      ${organizationId}, ${input.dealId}, ${input.commercialsId}, 'draft',
      ${JSON.stringify(input.content)}::jsonb, ${input.createdBy}
    )
    RETURNING id
  `);
  return row.id;
}

export async function updateBriefContent(
  tx: Tx,
  organizationId: string,
  id: string,
  content: DeliveryBriefContent,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE delivery_brief
       SET content    = ${JSON.stringify(content)}::jsonb,
           updated_at = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markSubmitted(
  tx: Tx,
  organizationId: string,
  id: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE delivery_brief
       SET state        = 'submitted',
           submitted_at = COALESCE(submitted_at, ${now}),
           change_notes = NULL,
           updated_at   = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markChangesRequested(
  tx: Tx,
  organizationId: string,
  id: string,
  reviewedBy: string,
  changeNotes: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE delivery_brief
       SET state        = 'changes_requested',
           reviewed_by  = ${reviewedBy},
           reviewed_at  = ${now},
           change_notes = ${changeNotes},
           updated_at   = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markAccepted(
  tx: Tx,
  organizationId: string,
  id: string,
  acceptedBy: string,
  projectId: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE delivery_brief
       SET state       = 'accepted',
           project_id  = ${projectId},
           reviewed_by = ${acceptedBy},
           reviewed_at = ${now},
           accepted_at = ${now},
           accepted_by = ${acceptedBy},
           updated_at  = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markCancelled(
  tx: Tx,
  organizationId: string,
  id: string,
  reviewedBy: string,
  reason: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE delivery_brief
       SET state            = 'cancelled',
           reviewed_by      = ${reviewedBy},
           reviewed_at      = ${now},
           cancelled_at     = ${now},
           cancelled_reason = ${reason},
           updated_at       = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

/**
 * Snapshot of the deal fields the brief service cares about: lifecycle
 * (cancellation after Won needs stronger authority) and the current
 * commercials pointer (defaults for `startBrief`).
 */
export interface DealContextSnapshot {
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly commercialsId: string | null;
}

export async function loadDealContext(
  tx: Tx,
  organizationId: string,
  dealId: string,
): Promise<DealContextSnapshot | null> {
  return tx.maybeOne<DealContextSnapshot>(sql`
    SELECT id,
           lifecycle_status AS "lifecycleStatus",
           commercials_id   AS "commercialsId"
      FROM deal
     WHERE organization_id = ${organizationId}
       AND id              = ${dealId}
  `);
}

export interface CommercialsSnapshot {
  readonly id: string;
  readonly dealId: string;
  readonly state: string;
}

export async function loadCommercials(
  tx: Tx,
  organizationId: string,
  commercialsId: string,
): Promise<CommercialsSnapshot | null> {
  return tx.maybeOne<CommercialsSnapshot>(sql`
    SELECT id,
           deal_id AS "dealId",
           state
      FROM commercials
     WHERE organization_id = ${organizationId}
       AND id              = ${commercialsId}
  `);
}

export interface ProjectCheck {
  readonly id: string;
}

export async function checkProjectExists(
  tx: Tx,
  organizationId: string,
  projectId: string,
): Promise<ProjectCheck | null> {
  return tx.maybeOne<ProjectCheck>(sql`
    SELECT id
      FROM project
     WHERE organization_id = ${organizationId}
       AND id              = ${projectId}
  `);
}

export async function insertBriefAudit(
  tx: Tx,
  ctx: RequestContext,
  action: string,
  briefId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'deliveryBrief',
      targetId: briefId,
      before,
      after,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}
