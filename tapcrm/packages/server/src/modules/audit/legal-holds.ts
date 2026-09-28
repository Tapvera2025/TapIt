import { globalAccess } from '@tapcrm/contracts';
import { AuthorizationError, MATCH_NOTHING, type Resource, type SqlFragment } from '@tapcrm/authz';
import { db, type Tx } from '../../platform/dal/db.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';
import type { Json } from './chain.js';

export const HOLD_TYPES = ['user', 'client', 'date-range'] as const;
export type LegalHoldType = (typeof HOLD_TYPES)[number];
export type LegalHoldStatus = 'active' | 'released';

interface LegalHoldRow {
  readonly id: string;
  readonly organizationId: string;
  readonly holdType: LegalHoldType;
  readonly targetId: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly reason: string;
  readonly placedBy: string;
  readonly placedAt: Date;
  readonly releasedBy: string | null;
  readonly releasedAt: Date | null;
  readonly status: LegalHoldStatus;
}

export interface LegalHold extends LegalHoldRow, Resource {
  readonly type: 'legalHold';
}

export interface LegalHoldInput {
  readonly holdType: LegalHoldType;
  readonly targetId: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly reason: string;
}

export interface LegalHoldTarget {
  readonly id: string;
  readonly kind: 'user' | 'client';
  readonly name: string;
  readonly code: string | null;
}

export interface AuditHoldMatch {
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly targetId: string | null;
  readonly occurredAt: Date;
}

export function legalHoldAccountType(holdType: LegalHoldType): 'employee' | 'client' | null {
  return holdType === 'user' ? 'employee' : holdType === 'client' ? 'client' : null;
}

function assertSuperAdmin(ctx: RequestContext): void {
  if (!globalAccess(ctx.principal)) {
    throw new AuthorizationError('audit:manage-holds', 'not_allowed', 'Only Super Admin can manage legal holds.');
  }
}

function holdRow(row: LegalHoldRow): LegalHold {
  return { ...row, type: 'legalHold' };
}

function auditEvent(tx: Tx, ctx: RequestContext, action: string, holdId: string, before: Json, after: Json, reason: string): Promise<unknown> {
  return tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'access', ${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'legalHold',
      targetId: holdId,
      before,
      after,
      reason,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}

const selectHold = sql.raw(`
  SELECT id, organization_id AS "organizationId", hold_type AS "holdType",
         target_id AS "targetId", starts_at AS "startsAt", ends_at AS "endsAt",
         reason, placed_by AS "placedBy", placed_at AS "placedAt",
         released_by AS "releasedBy", released_at AS "releasedAt", status
  FROM audit_legal_hold
`);

async function validateTarget(ctx: RequestContext, input: LegalHoldInput): Promise<void> {
  if (input.holdType === 'date-range') return;
  const target = await db.maybeOne<{ id: string; accountType: string }>(ctx, sql`
    SELECT id, account_type AS "accountType"
    FROM app_user
    WHERE organization_id = ${ctx.organizationId} AND id = ${input.targetId}
  `);
  const expectedAccountType = legalHoldAccountType(input.holdType);
  if (!target || target.accountType !== expectedAccountType) {
    throw new Error(`Legal hold target must be an organization ${input.holdType}.`);
  }
}

export async function createLegalHold(ctx: RequestContext, input: LegalHoldInput): Promise<LegalHold> {
  assertSuperAdmin(ctx);
  if (input.holdType !== 'date-range' && input.targetId === null) throw new Error('A target is required for this legal hold.');
  if (input.holdType === 'date-range' && (input.startsAt === null || input.endsAt === null || input.endsAt < input.startsAt)) {
    throw new Error('A date-range hold requires an ordered start and end date.');
  }
  await validateTarget(ctx, input);
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<LegalHoldRow>(sql`
      INSERT INTO audit_legal_hold (
        organization_id, hold_type, target_id, starts_at, ends_at, reason, placed_by
      ) VALUES (
        ${ctx.organizationId}, ${input.holdType}, ${input.targetId}, ${input.startsAt}, ${input.endsAt},
        ${input.reason.trim()}, ${ctx.principal.id}
      )
      RETURNING id, organization_id AS "organizationId", hold_type AS "holdType",
                target_id AS "targetId", starts_at AS "startsAt", ends_at AS "endsAt",
                reason, placed_by AS "placedBy", placed_at AS "placedAt",
                released_by AS "releasedBy", released_at AS "releasedAt", status
    `);
    const hold = holdRow(row);
    await auditEvent(tx, ctx, 'audit.legal_hold_placed', hold.id, null, {
      holdType: hold.holdType,
      targetId: hold.targetId,
      startsAt: hold.startsAt?.toISOString() ?? null,
      endsAt: hold.endsAt?.toISOString() ?? null,
      reason: hold.reason,
    }, hold.reason);
    return hold;
  });
}

export async function listLegalHolds(ctx: RequestContext, status: LegalHoldStatus | 'all' = 'active'): Promise<{ holds: LegalHold[] }> {
  assertSuperAdmin(ctx);
  const rows = await db.query<LegalHoldRow>(ctx, sql`
    ${selectHold}
    WHERE organization_id = ${ctx.organizationId}
      AND (${status} = 'all' OR status = ${status})
    ORDER BY placed_at DESC, id DESC
  `);
  return { holds: rows.map(holdRow) };
}

/** Tenant-scoped labels for the hold form; IDs remain an API implementation detail. */
export async function listLegalHoldTargets(ctx: RequestContext): Promise<{ targets: LegalHoldTarget[] }> {
  assertSuperAdmin(ctx);
  const rows = await db.query<LegalHoldTarget>(ctx, sql`
    SELECT id,
           CASE WHEN account_type = 'client' THEN 'client' ELSE 'user' END AS kind,
           full_name AS name,
           CASE WHEN account_type = 'employee' THEN employee_id ELSE email::text END AS code
    FROM app_user
    WHERE organization_id = ${ctx.organizationId}
      AND account_type IN ('employee', 'client')
      AND status = 'active'
    ORDER BY full_name, id
  `);
  return { targets: rows };
}

export async function loadLegalHoldResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<LegalHoldRow>(ctx, sql`
    ${selectHold}
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
  return row ? holdRow(row) : null;
}

export async function releaseLegalHold(ctx: RequestContext, id: string, releaseReason: string | null): Promise<LegalHold> {
  assertSuperAdmin(ctx);
  return db.transaction(ctx, async (tx) => {
    const existing = await tx.maybeOne<LegalHoldRow>(sql`
      ${selectHold}
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
      FOR UPDATE
    `);
    if (!existing) throw new Error('Legal hold not found.');
    if (existing['status'] === 'released') return holdRow(existing);
    const row = await tx.one<LegalHoldRow>(sql`
      UPDATE audit_legal_hold
      SET status = 'released', released_by = ${ctx.principal.id}, released_at = now()
      WHERE organization_id = ${ctx.organizationId} AND id = ${id} AND status = 'active'
      RETURNING id, organization_id AS "organizationId", hold_type AS "holdType",
                target_id AS "targetId", starts_at AS "startsAt", ends_at AS "endsAt",
                reason, placed_by AS "placedBy", placed_at AS "placedAt",
                released_by AS "releasedBy", released_at AS "releasedAt", status
    `);
    const hold = holdRow(row);
    await auditEvent(tx, ctx, 'audit.legal_hold_released', hold.id, {
      holdType: existing.holdType,
      targetId: existing.targetId,
      startsAt: existing.startsAt?.toISOString() ?? null,
      endsAt: existing.endsAt?.toISOString() ?? null,
      reason: existing.reason,
    }, { status: hold.status, releaseReason }, releaseReason ?? existing.reason);
    return hold;
  });
}

export function isAuditEntryHeld(entry: AuditHoldMatch, holds: readonly Pick<LegalHold, 'status' | 'holdType' | 'targetId' | 'startsAt' | 'endsAt'>[]): boolean {
  return holds.some((hold) => {
    if (hold.status !== 'active') return false;
    if (hold.holdType === 'date-range') {
      return hold.startsAt !== null && hold.endsAt !== null && entry.occurredAt >= hold.startsAt && entry.occurredAt <= hold.endsAt;
    }
    return hold.targetId !== null && (entry.actorId === hold.targetId || entry.targetId === hold.targetId);
  });
}

/** Reusable retention predicate; this phase does not invoke retention. */
export function activeLegalHoldPredicate(): SqlFragment {
  return {
    sql: `EXISTS (
      SELECT 1 FROM audit_legal_hold lh
      WHERE lh.organization_id = ae.organization_id AND lh.status = 'active'
        AND (
          (lh.hold_type IN ('user', 'client') AND (ae.actor_id = lh.target_id OR ae.target_id = lh.target_id))
          OR (lh.hold_type = 'date-range' AND ae.occurred_at >= lh.starts_at AND ae.occurred_at <= lh.ends_at)
        )
    )`,
    parameters: [],
  };
}

export function noLegalHoldFilter(): SqlFragment {
  return MATCH_NOTHING;
}
