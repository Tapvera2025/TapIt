import type { Action, Scope } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { DelegationTarget } from './delegation.js';

/**
 * Every query here is tenant-scoped through `db`, which sets the RLS context.
 * `organizationalLevel` lives on `position`, not `app_user`, so the target
 * lookup joins it.
 */

export interface OverrideRecord {
  id: string;
  userId: string;
  action: Action;
  allowed: boolean;
  scope: Scope;
  fields: string[] | null;
  reason: string;
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export async function findDelegationTarget(
  ctx: RequestContext,
  userId: string,
): Promise<DelegationTarget | null> {
  const rows = await db.query<DelegationTarget & { accountType: string }>(
    ctx,
    sql`
      SELECT u.id, u.organization_id, u.department_id, u.team_id, u.account_type,
             COALESCE(p.organizational_level, 0) AS organizational_level
      FROM app_user u
      LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
      WHERE u.organization_id = ${ctx.organizationId} AND u.id = ${userId}
        AND u.status <> 'offboarded'
    `,
  );
  return rows[0] ?? null;
}

export async function insertOverride(
  tx: Tx,
  input: {
    organizationId: string;
    userId: string;
    action: Action;
    allowed: boolean;
    scope: Scope;
    fields: readonly string[] | null;
    reason: string;
    grantedBy: string;
    expiresAt: Date | null;
  },
): Promise<{ id: string }> {
  // An override REPLACES the position policy for that action (§4.4), and only
  // one may be live at a time — superseding rather than deleting keeps the
  // earlier grant auditable.
  await tx.query(sql`
    UPDATE user_override SET revoked_at = now()
    WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId}
      AND action = ${input.action} AND revoked_at IS NULL
  `);
  return tx.one<{ id: string }>(sql`
    INSERT INTO user_override
      (organization_id, user_id, action, allowed, scope, fields, reason, granted_by, expires_at)
    VALUES (${input.organizationId}, ${input.userId}, ${input.action}, ${input.allowed},
            ${input.scope}, ${input.fields === null ? null : [...input.fields]}::text[],
            ${input.reason}, ${input.grantedBy}, ${input.expiresAt})
    RETURNING id
  `);
}

export async function revokeOverrideRow(
  tx: Tx,
  organizationId: string,
  overrideId: string,
): Promise<OverrideRecord | null> {
  return tx.maybeOne<OverrideRecord>(sql`
    UPDATE user_override SET revoked_at = now()
    WHERE organization_id = ${organizationId} AND id = ${overrideId} AND revoked_at IS NULL
    RETURNING id, user_id, action, allowed, scope, fields, reason, granted_by, granted_at,
              expires_at, revoked_at
  `);
}

/** AM-13 — one audit row per write, chained by the drainer after commit. */
export async function enqueueAccessAudit(
  tx: Tx,
  ctx: RequestContext,
  input: {
    action: string;
    targetId: string | null;
    before: unknown;
    after: unknown;
    reason: string | null;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
      action: input.action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'user',
      targetId: input.targetId,
      before: input.before,
      after: input.after,
      reason: input.reason,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}
