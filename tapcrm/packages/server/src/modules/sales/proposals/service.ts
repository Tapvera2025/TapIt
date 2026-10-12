/**
 * Sales v1.1 R2 — Proposals service (R2 plan step 2.9).
 *
 * Owns draft → published versioning on commercials rows. Every total is
 * computed via `recompute()` from the commercials module; this service
 * never does its own math. Publishing freezes the row by stamping a PDF
 * checksum and marking any prior published version `superseded`.
 */

import { ApplicationError } from '../../../errors.js';
import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { recompute } from '../commercials/service.js';
import type { DealResource } from '../deals/types.js';
import { evaluateDimensionsForRow } from '../approvals/dimensions.js';
import { loadUserAuthority, toActorAuthority } from '../approvals/repository.js';
import { commercialsChecksum, commercialsRowToChecksumInput } from './checksum.js';
import { issueToken, revokeToken, type IssuedToken } from './portal/token.js';
import {
  deleteItemsForCommercials,
  findCommercials,
  findCommercialsTx,
  insertCommercials,
  insertCommercialsAudit,
  insertCommercialsItem,
  listVersionsForDeal,
  loadDealApprovalSnapshot,
  lockCommercials,
  markPublished,
  markSupersededOtherVersions,
  nextVersionForDeal,
  setActiveCommercialsOnDeal,
  updateDraftFields,
} from './repository.js';
import type { Commercials } from './types.js';
import type {
  CommercialsBodyInput,
  CreateDraftInput,
  UpdateDraftInput,
} from './validators.js';

export class CommercialsNotFoundError extends ApplicationError {
  constructor() {
    super('Commercials not found', 404, 'COMMERCIALS_NOT_FOUND');
    this.name = 'CommercialsNotFoundError';
  }
}

export class CommercialsVersionLockedError extends ApplicationError {
  constructor(state: string) {
    super(
      `Commercials version is ${state}; only drafts may be edited.`,
      409,
      'COMMERCIALS_VERSION_LOCKED',
      { state },
    );
    this.name = 'CommercialsVersionLockedError';
  }
}

export class CommercialsOptimisticLockError extends ApplicationError {
  constructor(expected: Date, actual: Date, serverCopy: Commercials) {
    super(
      'Commercials was modified since you loaded it; refresh and retry.',
      409,
      'COMMERCIALS_STALE_WRITE',
      {
        expectedUpdatedAt: expected.toISOString(),
        actualUpdatedAt: actual.toISOString(),
        serverCopy,
      },
    );
    this.name = 'CommercialsOptimisticLockError';
  }
}

export class CommercialsPublishBlockedError extends ApplicationError {
  constructor(reason: 'approval_pending' | 'approval_rejected' | 'approval_required' | 'deal_closed' | 'empty_items') {
    const messages: Record<typeof reason, string> = {
      approval_pending: 'Approval is pending; publish is blocked until the request is decided.',
      approval_rejected: 'Approval was rejected; create a new version addressing the feedback.',
      approval_required: 'Commercials dimensions exceed authority; request approval before publishing.',
      deal_closed: 'Deal lifecycle is already terminal; publish is not permitted.',
      empty_items: 'Commercials cannot be published without at least one line item.',
    };
    super(messages[reason], 409, 'COMMERCIALS_PUBLISH_BLOCKED', { reason });
    this.name = 'CommercialsPublishBlockedError';
  }
}

export async function getCommercials(ctx: RequestContext, id: string): Promise<Commercials> {
  const commercials = await findCommercials(ctx, id);
  if (!commercials) throw new CommercialsNotFoundError();
  return commercials;
}

export async function listVersions(ctx: RequestContext, dealId: string): Promise<readonly Commercials[]> {
  return listVersionsForDeal(ctx, dealId);
}

/**
 * Resource loader for route-level authorization — returns the parent deal
 * so route-level `deals:edit` / `deals:view` authz runs against it. Keeps
 * the policy registry one-shaped: all commercials access flows through the
 * owning deal.
 */
export async function loadDealForCommercials(ctx: RequestContext, commercialsId: string): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    responsibleCloserId: string;
    originatingAgentId: string;
    lifecycleStatus: string;
  }>(
    ctx,
    sql`SELECT d.id,
               d.organization_id       AS "organizationId",
               d.responsible_closer_id AS "responsibleCloserId",
               d.originating_agent_id  AS "originatingAgentId",
               d.lifecycle_status      AS "lifecycleStatus"
          FROM commercials c
          JOIN deal d ON d.organization_id = c.organization_id AND d.id = c.deal_id
         WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${commercialsId}`,
  );
  if (!row) return null;
  const resource: DealResource = { type: 'deal', ...row, lifecycleStatus: row.lifecycleStatus as DealResource['lifecycleStatus'] };
  return resource;
}

function writeFieldsFrom(body: CommercialsBodyInput, totals: ReturnType<typeof recompute>): {
  currency: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  advanceMinor: bigint;
  validityAt: Date | null;
  scope: string | null;
  exclusions: string | null;
  timeline: string | null;
  terms: string | null;
} {
  return {
    currency: body.currency,
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
    advanceMinor: body.advanceMinor,
    validityAt: body.validityAt ?? null,
    scope: body.scope ?? null,
    exclusions: body.exclusions ?? null,
    timeline: body.timeline ?? null,
    terms: body.terms ?? null,
  };
}

async function writeItems(
  tx: Parameters<typeof insertCommercialsItem>[0],
  organizationId: string,
  commercialsId: string,
  body: CommercialsBodyInput,
  totals: ReturnType<typeof recompute>,
): Promise<void> {
  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i]!;
    const lineTotal = totals.lineTotals[i]!;
    await insertCommercialsItem(tx, organizationId, {
      commercialsId,
      serviceName: item.serviceName,
      description: item.description ?? null,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      itemDiscountMinor: item.itemDiscountMinor,
      taxCategory: item.taxCategory,
      taxRateBps: item.taxRateBps,
      lineTotalMinor: lineTotal,
      milestone: item.milestone ?? null,
      sortOrder: item.sortOrder || i,
    });
  }
}

export async function createDraft(
  ctx: RequestContext,
  dealId: string,
  input: CreateDraftInput,
): Promise<Commercials> {
  const totals = recompute(input);

  const commercialsId = await db.transaction(ctx, async (tx) => {
    const deal = await loadDealApprovalSnapshot(tx, ctx.organizationId, dealId);
    if (!deal) throw new ApplicationError('Deal not found', 404, 'DEAL_NOT_FOUND');
    if (deal.lifecycleStatus !== 'open') {
      throw new CommercialsPublishBlockedError('deal_closed');
    }
    const version = await nextVersionForDeal(tx, ctx.organizationId, dealId);
    const id = await insertCommercials(tx, ctx.organizationId, {
      dealId,
      version,
      ...writeFieldsFrom(input, totals),
      createdBy: ctx.principal.id,
    });
    await writeItems(tx, ctx.organizationId, id, input, totals);
    await insertCommercialsAudit(tx, ctx, 'commercials.draft_created', id, null, {
      dealId,
      version,
      totalMinor: totals.totalMinor.toString(),
    });
    return id;
  });

  const created = await findCommercials(ctx, commercialsId);
  if (!created) throw new CommercialsNotFoundError();
  return created;
}

export async function updateDraft(
  ctx: RequestContext,
  commercialsId: string,
  input: UpdateDraftInput,
): Promise<Commercials> {
  const totals = recompute(input.body);

  await db.transaction(ctx, async (tx) => {
    const locked = await lockCommercials(tx, ctx.organizationId, commercialsId);
    if (!locked) throw new CommercialsNotFoundError();
    if (locked.state !== 'draft') {
      throw new CommercialsVersionLockedError(locked.state);
    }
    const expected = input.expectedUpdatedAt.getTime();
    const actual = locked.updatedAt.getTime();
    if (expected !== actual) {
      const serverCopy = await findCommercialsTx(tx, ctx.organizationId, commercialsId);
      if (!serverCopy) throw new CommercialsNotFoundError();
      throw new CommercialsOptimisticLockError(input.expectedUpdatedAt, locked.updatedAt, serverCopy);
    }
    const before = await findCommercialsTx(tx, ctx.organizationId, commercialsId);
    await updateDraftFields(tx, ctx.organizationId, commercialsId, writeFieldsFrom(input.body, totals));
    await deleteItemsForCommercials(tx, ctx.organizationId, commercialsId);
    await writeItems(tx, ctx.organizationId, commercialsId, input.body, totals);
    await insertCommercialsAudit(tx, ctx, 'commercials.draft_updated', commercialsId,
      before ? {
        totalMinor: before.totalMinor.toString(),
        items: before.items.length,
      } : null,
      { totalMinor: totals.totalMinor.toString(), items: input.body.items.length },
    );
    // R-APP-05 — material commercials change invalidates any pending
    // approval for the deal; the salesperson re-requests after revising.
    const materialChange =
      !before
      || before.totalMinor !== totals.totalMinor
      || before.discountMinor !== totals.discountMinor
      || before.advanceMinor !== input.body.advanceMinor
      || before.items.length !== input.body.items.length
      || (before.terms ?? '') !== (input.body.terms ?? '');
    if (materialChange && locked.dealId) {
      const invalidated = await tx.query<{ id: string }>(sql`
        UPDATE approval_request
           SET state          = 'invalidated',
               blocked_reason  = 'commercials_changed',
               updated_at      = now()
         WHERE organization_id = ${ctx.organizationId}
           AND deal_id         = ${locked.dealId}
           AND state IN ('pending','escalated','returned')
         RETURNING id
      `);
      if (invalidated.length > 0) {
        await tx.query(sql`
          UPDATE deal
             SET approval_status = 'not_required',
                 updated_at      = now()
           WHERE organization_id = ${ctx.organizationId}
             AND id              = ${locked.dealId}
        `);
        for (const row of invalidated) {
          await insertCommercialsAudit(tx, ctx, 'approval.invalidated', row.id,
            { reason: 'commercials_changed' },
            { state: 'invalidated' },
          );
        }
      }
    }
  });

  const updated = await findCommercials(ctx, commercialsId);
  if (!updated) throw new CommercialsNotFoundError();
  return updated;
}

export async function publishVersion(ctx: RequestContext, commercialsId: string): Promise<Commercials> {
  const now = new Date();

  let publishedId: string;
  let dealId: string;

  const outcome = await db.transaction(ctx, async (tx) => {
    const locked = await lockCommercials(tx, ctx.organizationId, commercialsId);
    if (!locked) throw new CommercialsNotFoundError();

    if (locked.state === 'published') {
      // Idempotent — a repeat publish on an already-published version is a no-op.
      return { alreadyPublished: true, dealId: locked.dealId };
    }
    if (locked.state !== 'draft') {
      throw new CommercialsVersionLockedError(locked.state);
    }

    const deal = await loadDealApprovalSnapshot(tx, ctx.organizationId, locked.dealId);
    if (!deal) throw new ApplicationError('Deal not found', 404, 'DEAL_NOT_FOUND');
    if (deal.lifecycleStatus !== 'open') {
      throw new CommercialsPublishBlockedError('deal_closed');
    }
    if (deal.approvalStatus === 'pending') {
      throw new CommercialsPublishBlockedError('approval_pending');
    }
    if (deal.approvalStatus === 'rejected') {
      throw new CommercialsPublishBlockedError('approval_rejected');
    }

    const current = await findCommercialsTx(tx, ctx.organizationId, commercialsId);
    if (!current) throw new CommercialsNotFoundError();
    if (current.items.length === 0) {
      throw new CommercialsPublishBlockedError('empty_items');
    }

    // R-APP-01 / R-PROP-02 — if the current totals exceed the publisher's
    // authority, approval must have been granted. `not_required` is only
    // legitimate when dimensions are within bounds; if they aren't, the
    // salesperson has to request approval first.
    if (deal.approvalStatus === 'not_required') {
      const authorityRow = await loadUserAuthority(ctx, ctx.principal.id);
      if (authorityRow) {
        const snap = evaluateDimensionsForRow(current, toActorAuthority(authorityRow));
        if (snap.requiresApproval) {
          throw new CommercialsPublishBlockedError('approval_required');
        }
      }
    }

    const checksum = commercialsChecksum(commercialsRowToChecksumInput(current));
    await markPublished(tx, ctx.organizationId, commercialsId, checksum, ctx.principal.id, now);
    await markSupersededOtherVersions(tx, ctx.organizationId, locked.dealId, commercialsId, now);
    await setActiveCommercialsOnDeal(tx, ctx.organizationId, locked.dealId, commercialsId);
    await insertCommercialsAudit(tx, ctx, 'commercials.published', commercialsId,
      { state: 'draft' },
      { state: 'published', pdfChecksum: checksum, totalMinor: current.totalMinor.toString() },
    );
    return { alreadyPublished: false, dealId: locked.dealId };
  });

  publishedId = commercialsId;
  dealId = outcome.dealId;
  void dealId;

  const published = await findCommercials(ctx, publishedId);
  if (!published) throw new CommercialsNotFoundError();
  return published;
}

/**
 * Issue a share link (R-PORTAL-01) for a published version. The raw token
 * is returned ONCE here; the server only persists its SHA-256 digest.
 * Expiry is min(validity_at, now + 30d).
 */
export async function createShareLink(ctx: RequestContext, commercialsId: string): Promise<{
  rawToken: string;
  tokenId: string;
  expiresAt: Date;
  /**
   * Path relative to the SPA origin, suitable for a customer-facing URL.
   * The SPA must mount a public page at this path that reads the token
   * and calls `/api/public/proposals/:token`. `portalApiPath` is the raw
   * data endpoint for callers that want JSON directly.
   */
  portalPath: string;
  portalApiPath: string;
}> {
  const commercials = await findCommercials(ctx, commercialsId);
  if (!commercials) throw new CommercialsNotFoundError();
  if (commercials.state !== 'published' && commercials.state !== 'accepted') {
    throw new CommercialsVersionLockedError(commercials.state);
  }
  const issued: IssuedToken = await db.transaction(ctx, async (tx) =>
    issueToken(tx, ctx, {
      commercialsId,
      validityAt: commercials.validityAt,
      createdBy: ctx.principal.id,
    }),
  );
  return {
    rawToken: issued.rawToken,
    tokenId: issued.tokenId,
    expiresAt: issued.expiresAt,
    portalPath: `/public/proposals/${issued.rawToken}`,
    portalApiPath: `/api/public/proposals/${issued.rawToken}`,
  };
}

/** Revoke a previously issued share-link token. */
export async function revokeShareLink(ctx: RequestContext, tokenId: string): Promise<void> {
  await revokeToken(ctx, tokenId);
}

/**
 * Mark a specific published version `superseded`. Internal admin path; the
 * normal flow via `publishVersion` supersedes prior published versions
 * automatically.
 */
export async function supersede(ctx: RequestContext, commercialsId: string): Promise<Commercials> {
  const now = new Date();
  await db.transaction(ctx, async (tx) => {
    const locked = await lockCommercials(tx, ctx.organizationId, commercialsId);
    if (!locked) throw new CommercialsNotFoundError();
    if (locked.state !== 'published') {
      throw new CommercialsVersionLockedError(locked.state);
    }
    await tx.query(sql`
      UPDATE commercials
         SET state      = 'superseded',
             updated_at = ${now}
       WHERE organization_id = ${ctx.organizationId}
         AND id              = ${commercialsId}
    `);
    await insertCommercialsAudit(tx, ctx, 'commercials.superseded', commercialsId,
      { state: 'published' },
      { state: 'superseded', at: now.toISOString() },
    );
  });
  const row = await findCommercials(ctx, commercialsId);
  if (!row) throw new CommercialsNotFoundError();
  return row;
}
