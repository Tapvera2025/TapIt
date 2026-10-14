/**
 * Sales v1.1 R2 — Proposal (Commercials) repository (R2 plan step 2.9).
 *
 * Owns all SQL against `commercials` + `commercials_item`. The service
 * layer never writes a raw query; it composes the methods here inside a
 * `db.transaction`.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { CommercialsState } from '../commercials/types.js';
import type { Commercials, CommercialsItemRow } from './types.js';

interface CommercialsRow {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly version: number;
  readonly state: CommercialsState;
  readonly currency: string;
  readonly subtotalMinor: string;              // bigint arrives as string
  readonly discountMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
  readonly advanceMinor: string;
  readonly validityAt: Date | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
  readonly pdfChecksum: string | null;
  readonly publishedAt: Date | null;
  readonly publishedBy: string | null;
  readonly acceptedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ItemRow {
  readonly id: string;
  readonly commercialsId: string;
  readonly serviceName: string;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly itemDiscountMinor: string;
  readonly taxCategory: string;
  readonly taxRateBps: number;
  readonly lineTotalMinor: string;
  readonly milestone: string | null;
  readonly sortOrder: number;
}

const COMMERCIALS_SELECT = sql`
  SELECT c.id,
         c.organization_id   AS "organizationId",
         c.deal_id           AS "dealId",
         c.version,
         c.state,
         c.currency,
         c.subtotal_minor::text AS "subtotalMinor",
         c.discount_minor::text AS "discountMinor",
         c.tax_minor::text      AS "taxMinor",
         c.total_minor::text    AS "totalMinor",
         c.advance_minor::text  AS "advanceMinor",
         c.validity_at       AS "validityAt",
         c.scope,
         c.exclusions,
         c.timeline,
         c.terms,
         c.pdf_checksum      AS "pdfChecksum",
         c.published_at      AS "publishedAt",
         c.published_by      AS "publishedBy",
         c.accepted_at       AS "acceptedAt",
         c.created_by        AS "createdBy",
         c.created_at        AS "createdAt",
         c.updated_at        AS "updatedAt"
    FROM commercials c
`;

const ITEM_SELECT = sql`
  SELECT ci.id,
         ci.commercials_id   AS "commercialsId",
         ci.service_name     AS "serviceName",
         ci.description,
         ci.quantity::text   AS "quantity",
         ci.unit_price_minor::text AS "unitPriceMinor",
         ci.discount_minor::text   AS "itemDiscountMinor",
         ci.tax_category     AS "taxCategory",
         ci.tax_rate_bps     AS "taxRateBps",
         ci.line_total_minor::text AS "lineTotalMinor",
         ci.milestone,
         ci.sort_order       AS "sortOrder"
    FROM commercials_item ci
`;

function toItem(row: ItemRow): CommercialsItemRow {
  return {
    id: row.id,
    commercialsId: row.commercialsId,
    serviceName: row.serviceName,
    description: row.description,
    quantity: row.quantity,
    unitPriceMinor: BigInt(row.unitPriceMinor),
    itemDiscountMinor: BigInt(row.itemDiscountMinor),
    taxCategory: row.taxCategory,
    taxRateBps: row.taxRateBps,
    lineTotalMinor: BigInt(row.lineTotalMinor),
    milestone: row.milestone,
    sortOrder: row.sortOrder,
  };
}

function toCommercials(row: CommercialsRow, items: readonly CommercialsItemRow[]): Commercials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dealId: row.dealId,
    version: row.version,
    state: row.state,
    currency: row.currency,
    subtotalMinor: BigInt(row.subtotalMinor),
    discountMinor: BigInt(row.discountMinor),
    taxMinor: BigInt(row.taxMinor),
    totalMinor: BigInt(row.totalMinor),
    advanceMinor: BigInt(row.advanceMinor),
    validityAt: row.validityAt,
    scope: row.scope,
    exclusions: row.exclusions,
    timeline: row.timeline,
    terms: row.terms,
    pdfChecksum: row.pdfChecksum,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
    acceptedAt: row.acceptedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items,
  };
}

export async function findCommercials(ctx: RequestContext, id: string): Promise<Commercials | null> {
  const header = await db.maybeOne<CommercialsRow>(
    ctx,
    sql`${COMMERCIALS_SELECT} WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${id}`,
  );
  if (!header) return null;
  const items = await db.query<ItemRow>(
    ctx,
    sql`${ITEM_SELECT}
         WHERE ci.organization_id = ${ctx.organizationId} AND ci.commercials_id = ${id}
         ORDER BY ci.sort_order ASC, ci.service_name ASC`,
  );
  return toCommercials(header, items.map(toItem));
}

export async function findCommercialsTx(tx: Tx, organizationId: string, id: string): Promise<Commercials | null> {
  const header = await tx.maybeOne<CommercialsRow>(
    sql`${COMMERCIALS_SELECT} WHERE c.organization_id = ${organizationId} AND c.id = ${id}`,
  );
  if (!header) return null;
  const items = await tx.query<ItemRow>(
    sql`${ITEM_SELECT}
         WHERE ci.organization_id = ${organizationId} AND ci.commercials_id = ${id}
         ORDER BY ci.sort_order ASC, ci.service_name ASC`,
  );
  return toCommercials(header, items.map(toItem));
}

export async function listVersionsForDeal(ctx: RequestContext, dealId: string): Promise<readonly Commercials[]> {
  const headers = await db.query<CommercialsRow>(
    ctx,
    sql`${COMMERCIALS_SELECT}
         WHERE c.organization_id = ${ctx.organizationId} AND c.deal_id = ${dealId}
         ORDER BY c.version DESC`,
  );
  if (headers.length === 0) return [];
  const items = await db.query<ItemRow>(
    ctx,
    sql`${ITEM_SELECT}
         WHERE ci.organization_id = ${ctx.organizationId}
           AND ci.commercials_id = ANY(${headers.map((h) => h.id)}::uuid[])
         ORDER BY ci.sort_order ASC, ci.service_name ASC`,
  );
  const grouped = new Map<string, CommercialsItemRow[]>();
  for (const raw of items) {
    const mapped = toItem(raw);
    const bucket = grouped.get(mapped.commercialsId) ?? [];
    bucket.push(mapped);
    grouped.set(mapped.commercialsId, bucket);
  }
  return headers.map((h) => toCommercials(h, grouped.get(h.id) ?? []));
}

export interface LockedCommercials {
  readonly id: string;
  readonly dealId: string;
  readonly version: number;
  readonly state: CommercialsState;
  readonly updatedAt: Date;
  readonly pdfChecksum: string | null;
}

export async function lockCommercials(tx: Tx, organizationId: string, id: string): Promise<LockedCommercials | null> {
  return tx.maybeOne<LockedCommercials>(sql`
    SELECT id,
           deal_id        AS "dealId",
           version,
           state,
           updated_at     AS "updatedAt",
           pdf_checksum   AS "pdfChecksum"
      FROM commercials
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
     FOR UPDATE
  `);
}

export async function nextVersionForDeal(tx: Tx, organizationId: string, dealId: string): Promise<number> {
  const row = await tx.one<{ next: string }>(sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS next
      FROM commercials
     WHERE organization_id = ${organizationId}
       AND deal_id         = ${dealId}
  `);
  return Number(row.next);
}

export interface InsertCommercialsInput {
  readonly dealId: string;
  readonly version: number;
  readonly currency: string;
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly advanceMinor: bigint;
  readonly validityAt: Date | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
  readonly createdBy: string;
}

export async function insertCommercials(
  tx: Tx,
  organizationId: string,
  input: InsertCommercialsInput,
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO commercials (
      organization_id, deal_id, version, state, currency,
      subtotal_minor, discount_minor, tax_minor, total_minor, advance_minor,
      validity_at, scope, exclusions, timeline, terms, created_by
    ) VALUES (
      ${organizationId}, ${input.dealId}, ${input.version}, 'draft', ${input.currency},
      ${input.subtotalMinor.toString()}::bigint, ${input.discountMinor.toString()}::bigint,
      ${input.taxMinor.toString()}::bigint, ${input.totalMinor.toString()}::bigint,
      ${input.advanceMinor.toString()}::bigint,
      ${input.validityAt}, ${input.scope}, ${input.exclusions},
      ${input.timeline}, ${input.terms}, ${input.createdBy}
    )
    RETURNING id
  `);
  return row.id;
}

export interface UpdateDraftFields {
  readonly currency: string;
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly advanceMinor: bigint;
  readonly validityAt: Date | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
}

export async function updateDraftFields(
  tx: Tx,
  organizationId: string,
  id: string,
  fields: UpdateDraftFields,
): Promise<void> {
  await tx.query(sql`
    UPDATE commercials
       SET currency       = ${fields.currency},
           subtotal_minor = ${fields.subtotalMinor.toString()}::bigint,
           discount_minor = ${fields.discountMinor.toString()}::bigint,
           tax_minor      = ${fields.taxMinor.toString()}::bigint,
           total_minor    = ${fields.totalMinor.toString()}::bigint,
           advance_minor  = ${fields.advanceMinor.toString()}::bigint,
           validity_at    = ${fields.validityAt},
           scope          = ${fields.scope},
           exclusions     = ${fields.exclusions},
           timeline       = ${fields.timeline},
           terms          = ${fields.terms},
           updated_at     = now()
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function deleteItemsForCommercials(tx: Tx, organizationId: string, commercialsId: string): Promise<void> {
  await tx.query(sql`
    DELETE FROM commercials_item
     WHERE organization_id = ${organizationId}
       AND commercials_id  = ${commercialsId}
  `);
}

export interface InsertCommercialsItemInput {
  readonly commercialsId: string;
  readonly serviceName: string;
  readonly description: string | null;
  readonly quantity: string;              // decimal string, e.g. '2.5'
  readonly unitPriceMinor: bigint;
  readonly itemDiscountMinor: bigint;
  readonly taxCategory: string;
  readonly taxRateBps: number;
  readonly lineTotalMinor: bigint;
  readonly milestone: string | null;
  readonly sortOrder: number;
}

export async function insertCommercialsItem(
  tx: Tx,
  organizationId: string,
  input: InsertCommercialsItemInput,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO commercials_item (
      organization_id, commercials_id, service_name, description, quantity,
      unit_price_minor, discount_minor, tax_category, tax_rate_bps,
      line_total_minor, milestone, sort_order
    ) VALUES (
      ${organizationId}, ${input.commercialsId}, ${input.serviceName},
      ${input.description}, ${input.quantity}::numeric,
      ${input.unitPriceMinor.toString()}::bigint, ${input.itemDiscountMinor.toString()}::bigint,
      ${input.taxCategory}, ${input.taxRateBps},
      ${input.lineTotalMinor.toString()}::bigint, ${input.milestone}, ${input.sortOrder}
    )
  `);
}

export async function markPublished(
  tx: Tx,
  organizationId: string,
  id: string,
  pdfChecksum: string,
  publishedBy: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE commercials
       SET state         = 'published',
           pdf_checksum  = ${pdfChecksum},
           published_at  = ${now},
           published_by  = ${publishedBy},
           updated_at    = ${now}
     WHERE organization_id = ${organizationId}
       AND id              = ${id}
  `);
}

export async function markSupersededOtherVersions(
  tx: Tx,
  organizationId: string,
  dealId: string,
  keepId: string,
  now: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE commercials
       SET state      = 'superseded',
           updated_at = ${now}
     WHERE organization_id = ${organizationId}
       AND deal_id         = ${dealId}
       AND state           = 'published'
       AND id              <> ${keepId}
  `);
}

export async function setActiveCommercialsOnDeal(
  tx: Tx,
  organizationId: string,
  dealId: string,
  commercialsId: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE deal
       SET commercials_id = ${commercialsId},
           updated_at     = now()
     WHERE organization_id = ${organizationId}
       AND id              = ${dealId}
  `);
}

export interface DealApprovalSnapshot {
  readonly id: string;
  readonly approvalStatus: string;
  readonly lifecycleStatus: string;
}

export async function loadDealApprovalSnapshot(
  tx: Tx,
  organizationId: string,
  dealId: string,
): Promise<DealApprovalSnapshot | null> {
  return tx.maybeOne<DealApprovalSnapshot>(sql`
    SELECT id,
           approval_status  AS "approvalStatus",
           lifecycle_status AS "lifecycleStatus"
      FROM deal
     WHERE organization_id = ${organizationId}
       AND id              = ${dealId}
  `);
}

export async function insertCommercialsAudit(
  tx: Tx,
  ctx: RequestContext,
  action: string,
  commercialsId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'commercials',
      targetId: commercialsId,
      before,
      after,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}
