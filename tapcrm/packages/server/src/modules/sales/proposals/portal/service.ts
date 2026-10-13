/**
 * Sales v1.1 R2 — Public proposal portal (R2 plan step 2.10).
 *
 * The unauthenticated surface. Flow per request:
 *   1. Resolve the raw token → platform DB lookup, no tenant context.
 *   2. Rate-limit on tokenId and (tokenId, ip).
 *   3. Build a system-principal RequestContext bound to the token's
 *      organizationId so downstream reads go through the normal DAL.
 *   4. Load the commercials; enforce state gates (expired, revoked,
 *      superseded, already accepted by someone else → 410 Gone).
 *   5. For accept, record evidence atomically — idempotent on token hash
 *      so a replay from the same recipient re-returns the first result.
 */

import { ApplicationError } from '../../../../errors.js';
import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../../../platform/dal/context.js';
import { db } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import { consumeRateLimit } from '../../../../platform/security/rate-limit.js';
import { findCommercials } from '../repository.js';
import type { Commercials } from '../types.js';
import { resolveToken, type ResolvedToken } from './token.js';

const RATE_LIMIT_PER_TOKEN = 30;
const RATE_LIMIT_PER_TOKEN_WINDOW_S = 60;
const RATE_LIMIT_PER_IP = 10;
const RATE_LIMIT_PER_IP_WINDOW_S = 60;

export class PortalGoneError extends ApplicationError {
  constructor(reason: 'expired' | 'revoked' | 'superseded' | 'not_published' | 'rejected' | 'unknown') {
    super(`Proposal link is no longer available (${reason}).`, 410, 'PORTAL_GONE', { reason });
    this.name = 'PortalGoneError';
  }
}

export class PortalNotFoundError extends ApplicationError {
  constructor() {
    super('Proposal link not found.', 404, 'PORTAL_NOT_FOUND');
    this.name = 'PortalNotFoundError';
  }
}

export class PortalRateLimitedError extends ApplicationError {
  constructor(retryAfterSeconds: number) {
    super('Too many requests on this proposal link; try again shortly.', 429, 'PORTAL_RATE_LIMITED', {
      retryAfterSeconds,
    });
    this.name = 'PortalRateLimitedError';
  }
}

/** Public card projection — only buyer-facing fields leave the service. */
export interface PortalProposalCard {
  readonly currency: string;
  readonly subtotalMinor: string;
  readonly discountMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
  readonly advanceMinor: string;
  readonly validityAt: Date | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
  readonly publishedAt: Date;
  readonly items: ReadonlyArray<{
    readonly serviceName: string;
    readonly description: string | null;
    readonly quantity: string;
    readonly unitPriceMinor: string;
    readonly itemDiscountMinor: string;
    readonly taxCategory: string;
    readonly taxRateBps: number;
    readonly lineTotalMinor: string;
    readonly milestone: string | null;
  }>;
  readonly pdfChecksum: string;
  readonly state: 'published' | 'accepted';
  readonly acceptedAt: Date | null;
}

function systemCtxFor(organizationId: string): RequestContext {
  const principal: Principal = {
    id: '00000000-0000-0000-0000-000000000000',
    organizationId,
    sessionVersion: 0,
    accountType: 'service',
    allowedActions: [],
    allowedResources: [],
    expiresAt: new Date(0),
  };
  return createJobContext({
    organizationId,
    principal,
    jobName: 'sales.proposals.portal',
    runId: '-',
  });
}

export interface PortalRequestMetadata {
  readonly ip: string;
  readonly userAgent: string;
}

async function enforceRateLimit(tokenId: string, ip: string): Promise<void> {
  const perToken = await consumeRateLimit(
    `portal:tok:${tokenId}`,
    RATE_LIMIT_PER_TOKEN,
    RATE_LIMIT_PER_TOKEN_WINDOW_S,
  );
  if (!perToken.allowed) throw new PortalRateLimitedError(perToken.retryAfterSeconds);
  if (ip) {
    const perIp = await consumeRateLimit(
      `portal:tok:${tokenId}:ip:${ip}`,
      RATE_LIMIT_PER_IP,
      RATE_LIMIT_PER_IP_WINDOW_S,
    );
    if (!perIp.allowed) throw new PortalRateLimitedError(perIp.retryAfterSeconds);
  }
}

function assertUsableTokenRow(row: ResolvedToken, now = new Date()): void {
  if (row.revokedAt) throw new PortalGoneError('revoked');
  if (row.expiresAt.getTime() <= now.getTime()) throw new PortalGoneError('expired');
}

function assertUsableCommercialsState(state: Commercials['state']): asserts state is 'published' | 'accepted' {
  switch (state) {
    case 'published':
    case 'accepted':
      return;
    case 'superseded':
      throw new PortalGoneError('superseded');
    case 'expired':
      throw new PortalGoneError('expired');
    case 'rejected':
      throw new PortalGoneError('rejected');
    case 'draft':
      throw new PortalGoneError('not_published');
  }
}

function toCard(commercials: Commercials): PortalProposalCard {
  if (!commercials.pdfChecksum || !commercials.publishedAt) {
    // Only reachable if a published row somehow lacks a checksum; shouldn't
    // happen because publishVersion sets both together.
    throw new PortalGoneError('not_published');
  }
  return {
    currency: commercials.currency,
    subtotalMinor: commercials.subtotalMinor.toString(),
    discountMinor: commercials.discountMinor.toString(),
    taxMinor: commercials.taxMinor.toString(),
    totalMinor: commercials.totalMinor.toString(),
    advanceMinor: commercials.advanceMinor.toString(),
    validityAt: commercials.validityAt,
    scope: commercials.scope,
    exclusions: commercials.exclusions,
    timeline: commercials.timeline,
    terms: commercials.terms,
    publishedAt: commercials.publishedAt,
    items: commercials.items.map((item) => ({
      serviceName: item.serviceName,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor.toString(),
      itemDiscountMinor: item.itemDiscountMinor.toString(),
      taxCategory: item.taxCategory,
      taxRateBps: item.taxRateBps,
      lineTotalMinor: item.lineTotalMinor.toString(),
      milestone: item.milestone,
    })),
    pdfChecksum: commercials.pdfChecksum,
    state: commercials.state === 'accepted' ? 'accepted' : 'published',
    acceptedAt: commercials.acceptedAt,
  };
}

/**
 * GET /api/public/proposals/:token — returns the card. 404 for unknown
 * tokens; 410 for expired/revoked/superseded/rejected; 429 when the token
 * is being hammered.
 */
export async function viewProposal(rawToken: string, meta: PortalRequestMetadata): Promise<PortalProposalCard> {
  const resolved = await resolveToken(rawToken);
  if (!resolved) throw new PortalNotFoundError();
  await enforceRateLimit(resolved.tokenId, meta.ip);
  assertUsableTokenRow(resolved);
  const ctx = systemCtxFor(resolved.organizationId);
  const commercials = await findCommercials(ctx, resolved.commercialsId);
  if (!commercials) throw new PortalGoneError('unknown');
  assertUsableCommercialsState(commercials.state);
  return toCard(commercials);
}

export interface AcceptProposalInput {
  readonly comment?: string | undefined;
}

export interface AcceptProposalResult {
  readonly acceptedAt: Date;
  readonly pdfChecksum: string;
  readonly alreadyAccepted: boolean;
}

/**
 * POST /api/public/proposals/:token/accept — records acceptance. Idempotent
 * on token hash: a replayed accept from the same recipient returns the
 * original acceptedAt with `alreadyAccepted: true`.
 */
export async function acceptProposal(
  rawToken: string,
  input: AcceptProposalInput,
  meta: PortalRequestMetadata,
): Promise<AcceptProposalResult> {
  const resolved = await resolveToken(rawToken);
  if (!resolved) throw new PortalNotFoundError();
  await enforceRateLimit(resolved.tokenId, meta.ip);
  assertUsableTokenRow(resolved);

  const ctx = systemCtxFor(resolved.organizationId);
  const now = new Date();
  const tokenHash = resolved.tokenHash;

  const outcome = await db.transaction(ctx, async (tx) => {
    const locked = await tx.maybeOne<{
      id: string;
      state: Commercials['state'];
      pdfChecksum: string | null;
      acceptedAt: Date | null;
      acceptedEvidence: Record<string, unknown> | null;
    }>(sql`
      SELECT id,
             state,
             pdf_checksum     AS "pdfChecksum",
             accepted_at      AS "acceptedAt",
             accepted_evidence AS "acceptedEvidence"
        FROM commercials
       WHERE organization_id = ${ctx.organizationId}
         AND id              = ${resolved.commercialsId}
       FOR UPDATE
    `);
    if (!locked) throw new PortalGoneError('unknown');
    if (!locked.pdfChecksum) throw new PortalGoneError('not_published');

    if (locked.state === 'accepted') {
      // Replay from the same recipient (same token hash) is idempotent.
      const recordedHash = locked.acceptedEvidence?.['tokenHash'];
      if (recordedHash !== tokenHash) throw new PortalGoneError('rejected');
      return {
        acceptedAt: locked.acceptedAt!,
        pdfChecksum: locked.pdfChecksum,
        alreadyAccepted: true,
      };
    }

    if (locked.state !== 'published') {
      assertUsableCommercialsState(locked.state);
      throw new PortalGoneError('unknown');
    }

    const evidence = {
      tokenHash,
      ip: meta.ip,
      userAgent: meta.userAgent,
      acceptedAt: now.toISOString(),
      pdfChecksumAtAcceptance: locked.pdfChecksum,
      comment: input.comment ?? null,
    };

    await tx.query(sql`
      UPDATE commercials
         SET state             = 'accepted',
             accepted_at       = ${now},
             accepted_evidence = ${JSON.stringify(evidence)}::jsonb,
             updated_at        = ${now}
       WHERE organization_id = ${ctx.organizationId}
         AND id              = ${locked.id}
    `);
    await tx.query(sql`
      INSERT INTO audit_outbox (organization_id, stream, payload)
      VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
        action: 'commercials.accepted',
        actorType: 'public',
        targetType: 'commercials',
        targetId: locked.id,
        before: { state: 'published' },
        after: {
          state: 'accepted',
          at: now.toISOString(),
          tokenHashHead: tokenHash.slice(0, 12),
          ipHead: meta.ip ? meta.ip.slice(0, 24) : null,
        },
      })}::jsonb)
    `);
    return {
      acceptedAt: now,
      pdfChecksum: locked.pdfChecksum,
      alreadyAccepted: false,
    };
  });

  return outcome;
}

/**
 * POST /api/public/proposals/:token/question — records a comment without
 * state change. Lands in the audit stream for the issuer to triage. No
 * dedicated table yet; the audit log is enough until R3 adds a comments
 * UI.
 */
export async function recordQuestion(
  rawToken: string,
  input: { comment: string },
  meta: PortalRequestMetadata,
): Promise<{ recordedAt: Date }> {
  const resolved = await resolveToken(rawToken);
  if (!resolved) throw new PortalNotFoundError();
  await enforceRateLimit(resolved.tokenId, meta.ip);
  assertUsableTokenRow(resolved);

  const ctx = systemCtxFor(resolved.organizationId);
  const now = new Date();
  await db.query(ctx, sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action: 'commercials.question',
      actorType: 'public',
      targetType: 'commercials',
      targetId: resolved.commercialsId,
      before: null,
      after: {
        at: now.toISOString(),
        comment: input.comment.slice(0, 2000),
        tokenHashHead: resolved.tokenHash.slice(0, 12),
        ipHead: meta.ip ? meta.ip.slice(0, 24) : null,
        userAgentHead: (meta.userAgent ?? '').slice(0, 120),
      },
    })}::jsonb)
  `);
  return { recordedAt: now };
}
