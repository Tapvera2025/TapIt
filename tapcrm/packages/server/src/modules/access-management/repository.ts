import type { Action, Scope } from '@tapcrm/contracts';
import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { DelegationTarget } from './delegation.js';

export interface AccessSubjectRecord {
  id: string;
  organizationId: string;
  accountType: 'super-admin' | 'employee' | 'client' | 'service';
  email: string | null;
  fullName: string;
  status: string;
  positionId: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  organizationalLevel: number | null;
  positionName: string | null;
  departmentName: string | null;
  teamName: string | null;
}

export interface ActiveOverrideRecord {
  id: string;
  action: Action;
  allowed: boolean;
  scope: Scope;
  fields: string[] | null;
  constraints: string[] | null;
  reason: string;
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date | null;
}

export interface OverrideOverviewRecord {
  id: string;
  userId: string;
  fullName: string;
  email: string | null;
  accountType: 'employee' | 'super-admin';
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  positionId: string | null;
  positionName: string | null;
  departmentId: string | null;
  teamId: string | null;
  action: Action;
  allowed: boolean;
  scope: Scope;
  fields: string[] | null;
  reason: string;
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date | null;
  ageDays: number;
  reviewRequired: boolean;
  positionHolderCount: number;
  matchingOverrideCount: number;
}

export interface ExpiredOverrideRecord {
  id: string;
  userId: string;
  action: Action;
  allowed: boolean;
  scope: Scope;
  reason: string;
  expiresAt: Date;
}

export interface CapabilityHolderRecord {
  id: string;
  fullName: string;
  email: string | null;
  accountType: 'super-admin' | 'employee';
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  positionId: string | null;
  positionName: string | null;
  departmentId: string | null;
  teamId: string | null;
  source: 'position' | 'override' | 'super-admin';
  scope: Scope | null;
  fields: string[] | null;
  reason: string;
  overrideId: string | null;
  grantedBy: string | null;
  grantedAt: Date | null;
  expiresAt: Date | null;
}

export interface RoleChangeRequestRecord {
  id: string;
  subjectUserId: string;
  subjectName: string;
  subjectEmail: string | null;
  fromPositionId: string | null;
  fromPositionName: string | null;
  toPositionId: string;
  toPositionName: string | null;
  requestedReportsTo: string | null;
  requestedReportsToName: string | null;
  requestedBy: string;
  requesterName: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: Date;
  decidedAt: Date | null;
  decisionReason: string | null;
}

export async function findAccessSubject(
  ctx: RequestContext,
  userId: string,
): Promise<AccessSubjectRecord | null> {
  return db.maybeOne<AccessSubjectRecord>(ctx, sql`
    SELECT u.id,
           u.organization_id,
           u.account_type,
           u.email,
           u.full_name,
           u.status,
           u.position_id,
           u.department_id,
           u.team_id,
           u.reports_to,
           p.organizational_level,
           p.name AS position_name,
           d.name AS department_name,
           t.name AS team_name
    FROM app_user u
    LEFT JOIN position p
      ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN department d
      ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t
      ON t.organization_id = u.organization_id AND t.id = u.team_id
    WHERE u.organization_id = ${ctx.organizationId}
      AND u.id = ${userId}
      AND u.status = 'active'
  `);
}

export async function listActiveOverrides(
  ctx: RequestContext,
  userId: string,
): Promise<ActiveOverrideRecord[]> {
  return db.query<ActiveOverrideRecord>(ctx, sql`
    SELECT id, action, allowed, scope, fields, constraints, reason,
           granted_by, granted_at, expires_at
    FROM user_override
    WHERE organization_id = ${ctx.organizationId}
      AND user_id = ${userId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY granted_at DESC, id DESC
  `);
}

/** AM-9/AM-10: one server-side query for the review list and advisory counts. */
export async function listOverrideOverview(ctx: RequestContext): Promise<OverrideOverviewRecord[]> {
  return db.query<OverrideOverviewRecord>(ctx, sql`
    WITH active_holders AS (
      SELECT u.id, u.position_id
      FROM app_user u
      WHERE u.organization_id = ${ctx.organizationId}
        AND u.status = 'active'
        AND u.account_type = 'employee'
        AND u.position_id IS NOT NULL
    ), active_overrides AS (
      SELECT o.*
      FROM user_override o
      JOIN app_user u ON u.organization_id = o.organization_id AND u.id = o.user_id
      WHERE o.organization_id = ${ctx.organizationId}
        AND u.status = 'active'
        AND o.revoked_at IS NULL
        AND (o.expires_at IS NULL OR o.expires_at > now())
    ), matching AS (
      SELECT position_id, action, allowed, scope, fields,
             COUNT(DISTINCT user_id)::integer AS matching_override_count
      FROM active_overrides o
      JOIN app_user u ON u.organization_id = o.organization_id AND u.id = o.user_id
      WHERE u.position_id IS NOT NULL
      GROUP BY position_id, action, allowed, scope, fields
    ), holder_counts AS (
      SELECT position_id, COUNT(*)::integer AS position_holder_count
      FROM active_holders
      GROUP BY position_id
    )
    SELECT o.id,
           o.user_id,
           u.full_name,
           u.email,
           u.account_type,
           o.organization_id,
           org.code AS organization_code,
           org.name AS organization_name,
           u.position_id,
           p.name AS position_name,
           u.department_id,
           u.team_id,
           o.action,
           o.allowed,
           o.scope,
           o.fields,
           o.reason,
           o.granted_by,
           o.granted_at,
           o.expires_at,
           GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - o.granted_at)) / 86400))::integer AS age_days,
           (o.granted_at <= now() - interval '180 days') AS review_required,
           COALESCE(h.position_holder_count, 0)::integer AS position_holder_count,
           COALESCE(m.matching_override_count, 0)::integer AS matching_override_count
    FROM active_overrides o
    JOIN app_user u ON u.organization_id = o.organization_id AND u.id = o.user_id
    JOIN organization org ON org.id = o.organization_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN holder_counts h ON h.position_id = u.position_id
    LEFT JOIN matching m
      ON m.position_id = u.position_id
     AND m.action = o.action
     AND m.allowed = o.allowed
     AND m.scope = o.scope
     AND m.fields IS NOT DISTINCT FROM o.fields
    ORDER BY o.granted_at ASC, u.full_name ASC, o.id ASC
  `);
}

/** Maintenance only. Authorization continues to read expires_at directly. */
export async function markExpiredOverrides(tx: Tx): Promise<ExpiredOverrideRecord[]> {
  return tx.query<ExpiredOverrideRecord>(sql`
    UPDATE user_override
    SET expiry_audited_at = now()
    WHERE revoked_at IS NULL
      AND expiry_audited_at IS NULL
      AND expires_at IS NOT NULL
      AND expires_at <= now()
    RETURNING id, user_id, action, allowed, scope, reason, expires_at
  `);
}

export async function loadRoleChangeResource(
  ctx: RequestContext,
  requestId: string,
): Promise<Resource | null> {
  return db.maybeOne<Resource>(ctx, sql`
    SELECT 'roleChangeRequest' AS type, id,
           requested_by AS "requestedBy",
           subject_user_id AS "subjectUserId",
           organization_id AS "organizationId",
           status,
           to_position_id AS "toPositionId"
    FROM role_change_request
    WHERE organization_id = ${ctx.organizationId} AND id = ${requestId}
  `);
}

export async function listRoleChangeRequests(
  ctx: RequestContext,
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending',
): Promise<RoleChangeRequestRecord[]> {
  return db.query<RoleChangeRequestRecord>(ctx, sql`
    SELECT r.id,
           r.subject_user_id AS "subjectUserId",
           subject.full_name AS "subjectName",
           subject.email AS "subjectEmail",
           r.from_position_id AS "fromPositionId",
           from_position.name AS "fromPositionName",
           r.to_position_id AS "toPositionId",
           to_position.name AS "toPositionName",
           r.requested_reports_to AS "requestedReportsTo",
           requested_manager.full_name AS "requestedReportsToName",
           r.requested_by AS "requestedBy",
           requester.full_name AS "requesterName",
           r.reason,
           r.status,
           r.requested_at AS "requestedAt",
           r.decided_at AS "decidedAt",
           r.decision_reason AS "decisionReason"
    FROM role_change_request r
    JOIN app_user subject
      ON subject.organization_id = r.organization_id AND subject.id = r.subject_user_id
    JOIN app_user requester
      ON requester.organization_id = r.organization_id AND requester.id = r.requested_by
    LEFT JOIN position from_position
      ON from_position.organization_id = r.organization_id AND from_position.id = r.from_position_id
    LEFT JOIN position to_position
      ON to_position.organization_id = r.organization_id AND to_position.id = r.to_position_id
    LEFT JOIN app_user requested_manager
      ON requested_manager.organization_id = r.organization_id
     AND requested_manager.id = r.requested_reports_to
    WHERE r.organization_id = ${ctx.organizationId}
      AND (${status} = 'all' OR r.status = ${status})
    ORDER BY r.requested_at DESC, r.id DESC
  `);
}

/** The override id resolves to its target user for access:delegate checks. */
export async function loadOverrideResource(
  ctx: RequestContext,
  overrideId: string,
): Promise<Resource | null> {
  return db.maybeOne<Resource>(ctx, sql`
    SELECT 'user' AS type,
           u.id,
           u.organization_id AS "organizationId",
           u.department_id AS "departmentId",
           u.team_id AS "teamId"
    FROM user_override o
    JOIN app_user u
      ON u.organization_id = o.organization_id AND u.id = o.user_id
    WHERE o.organization_id = ${ctx.organizationId} AND o.id = ${overrideId}
  `);
}

export async function createRoleChangeRequest(
  tx: Tx,
  input: {
    organizationId: string;
    subjectUserId: string;
    fromPositionId: string | null;
    toPositionId: string;
    requestedBy: string;
    requestedReportsTo: string | null;
    reason: string;
  },
): Promise<{ id: string }> {
  return tx.one<{ id: string }>(sql`
    INSERT INTO role_change_request
      (organization_id, subject_user_id, from_position_id, to_position_id, requested_by,
       requested_reports_to, reason)
    VALUES (${input.organizationId}, ${input.subjectUserId}, ${input.fromPositionId},
            ${input.toPositionId}, ${input.requestedBy}, ${input.requestedReportsTo}, ${input.reason})
    RETURNING id
  `);
}

export async function lockRoleChangeRequest(
  tx: Tx,
  organizationId: string,
  requestId: string,
): Promise<{
  id: string;
  subjectUserId: string;
  fromPositionId: string | null;
  toPositionId: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  requestedReportsTo: string | null;
} | null> {
  return tx.maybeOne(sql`
    SELECT id, subject_user_id AS "subjectUserId", from_position_id AS "fromPositionId",
           to_position_id AS "toPositionId", requested_by AS "requestedBy",
           requested_reports_to AS "requestedReportsTo", status, reason
    FROM role_change_request
    WHERE organization_id = ${organizationId} AND id = ${requestId}
    FOR UPDATE
  `);
}

export async function findPositionForRoleChange(
  tx: Tx,
  organizationId: string,
  positionId: string,
): Promise<{ id: string; departmentId: string; status: string } | null> {
  return tx.maybeOne(sql`
    SELECT id, department_id, status
    FROM position
    WHERE organization_id = ${organizationId} AND id = ${positionId}
  `);
}

export async function applyRoleChange(
  tx: Tx,
  organizationId: string,
  userId: string,
  positionId: string,
  departmentId: string,
  requestedReportsTo: string | null,
): Promise<{ id: string }> {
  // Do not bind a nullable UUID in the unchanged case. PostgreSQL cannot
  // infer the type of a bare NULL parameter in some prepared statements.
  const reportsToAssignment =
    requestedReportsTo === null
      ? sql.raw('reports_to = reports_to')
      : sql`reports_to = ${requestedReportsTo}::uuid`;
  return tx.one(sql`
    UPDATE app_user
    SET position_id = ${positionId},
        department_id = ${departmentId},
        team_id = NULL,
        ${reportsToAssignment},
        session_version = session_version + 1
    WHERE organization_id = ${organizationId}
      AND id = ${userId}
      AND status = 'active'
    RETURNING id
  `);
}

export async function decideRoleChange(
  tx: Tx,
  organizationId: string,
  requestId: string,
  status: 'approved' | 'rejected',
  decidedBy: string,
  decisionReason: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE role_change_request
    SET status = ${status}, decided_by = ${decidedBy}, decided_at = now(), decision_reason = ${decisionReason}
    WHERE organization_id = ${organizationId} AND id = ${requestId} AND status = 'pending'
  `);
}

export async function listSubordinateUsers(
  ctx: RequestContext,
  userIds: readonly string[],
): Promise<AccessSubjectRecord[]> {
  if (userIds.length === 0) return [];
  return db.query<AccessSubjectRecord>(ctx, sql`
    SELECT u.id,
           u.organization_id,
           u.account_type,
           u.email,
           u.full_name,
           u.status,
           u.position_id,
           u.department_id,
           u.team_id,
           u.reports_to,
           p.organizational_level,
           p.name AS position_name,
           d.name AS department_name,
           t.name AS team_name
    FROM app_user u
    LEFT JOIN position p
      ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN department d
      ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t
      ON t.organization_id = u.organization_id AND t.id = u.team_id
    WHERE u.organization_id = ${ctx.organizationId}
      AND u.id = ANY(${[...userIds]}::uuid[])
      AND u.status = 'active'
    ORDER BY u.full_name, u.id
  `);
}

/**
 * AM-5: one tenant-scoped query resolves position defaults, active overrides,
 * and derived Super Admin access. The override row wins over the position row
 * for the same user/action, matching policyStore.resolveSet().
 */
export async function listCapabilityHolders(
  ctx: RequestContext,
  action: Action,
): Promise<CapabilityHolderRecord[]> {
  return db.query<CapabilityHolderRecord>(ctx, sql`
    WITH active_users AS (
      SELECT u.id, u.full_name, u.email, u.account_type, u.organization_id,
             u.position_id, u.department_id, u.team_id, p.name AS position_name
      FROM app_user u
      LEFT JOIN position p
        ON p.organization_id = u.organization_id AND p.id = u.position_id
      WHERE u.organization_id = ${ctx.organizationId}
        AND u.status = 'active'
        AND u.account_type IN ('employee', 'super-admin')
    ), active_overrides AS (
      SELECT DISTINCT ON (o.user_id)
             o.id, o.user_id, o.allowed, o.scope, o.fields, o.reason,
             o.granted_by, o.granted_at, o.expires_at
      FROM user_override o
      WHERE o.organization_id = ${ctx.organizationId}
        AND o.action = ${action}
        AND o.revoked_at IS NULL
        AND (o.expires_at IS NULL OR o.expires_at > now())
      ORDER BY o.user_id, o.granted_at DESC, o.id DESC
    ), effective_rows AS (
      SELECT au.id, au.full_name, au.email, au.account_type, au.organization_id,
             au.position_id, au.department_id, au.team_id, au.position_name,
             pp.allowed AS position_allowed, pp.scope AS position_scope,
             pp.fields AS position_fields,
             ao.id AS override_id, ao.allowed AS override_allowed,
             ao.scope AS override_scope, ao.fields AS override_fields,
             ao.reason AS override_reason, ao.granted_by, ao.granted_at,
             ao.expires_at
      FROM active_users au
      LEFT JOIN position_policy pp
        ON pp.organization_id = au.organization_id
       AND pp.position_id = au.position_id
       AND pp.action = ${action}
      LEFT JOIN active_overrides ao ON ao.user_id = au.id
    )
    SELECT e.id,
           e.full_name,
           e.email,
           e.account_type,
           e.organization_id,
           o.code AS organization_code,
           o.name AS organization_name,
           e.position_id,
           e.position_name,
           e.department_id,
           e.team_id,
           CASE
             WHEN e.account_type = 'super-admin' THEN 'super-admin'
             WHEN e.override_id IS NOT NULL THEN 'override'
             ELSE 'position'
           END AS source,
           CASE
             WHEN e.account_type = 'super-admin' THEN NULL
             WHEN e.override_id IS NOT NULL THEN e.override_scope
             ELSE e.position_scope
           END AS scope,
           CASE
             WHEN e.account_type = 'super-admin' THEN NULL
             WHEN e.override_id IS NOT NULL THEN e.override_fields
             ELSE e.position_fields
           END AS fields,
           CASE
             WHEN e.account_type = 'super-admin' THEN 'Global Super Admin access'
             WHEN e.override_id IS NOT NULL THEN e.override_reason
             ELSE 'Position policy'
           END AS reason,
           e.override_id,
           e.granted_by,
           e.granted_at,
           e.expires_at
    FROM effective_rows e
    JOIN organization o ON o.id = e.organization_id
    WHERE e.account_type = 'super-admin'
       OR (
         CASE WHEN e.override_id IS NOT NULL
              THEN e.override_allowed
              ELSE COALESCE(e.position_allowed, false)
         END
       ) = true
    ORDER BY e.account_type DESC, e.full_name, e.id
  `);
}

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
): Promise<{ id: string; replaced: OverrideRecord[] }> {
  // An override REPLACES the position policy for that action (§4.4), and only
  // one may be live at a time — superseding rather than deleting keeps the
  // earlier grant auditable.
  const replaced = await tx.query<OverrideRecord>(sql`
    UPDATE user_override SET revoked_at = now()
    WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId}
      AND action = ${input.action} AND revoked_at IS NULL
    RETURNING id, user_id, action, allowed, scope, fields, reason, granted_by, granted_at,
              expires_at, revoked_at
  `);
  const created = await tx.one<{ id: string }>(sql`
    INSERT INTO user_override
      (organization_id, user_id, action, allowed, scope, fields, reason, granted_by, expires_at)
    VALUES (${input.organizationId}, ${input.userId}, ${input.action}, ${input.allowed},
            ${input.scope}, ${input.fields === null ? null : [...input.fields]}::text[],
            ${input.reason}, ${input.grantedBy}, ${input.expiresAt})
    RETURNING id
  `);
  return { ...created, replaced };
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

export async function clearActiveOverridesForPositionChange(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<OverrideRecord[]> {
  return tx.query<OverrideRecord>(sql`
    UPDATE user_override
    SET revoked_at = now()
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
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
