import {
  REGISTRY,
  globalAccess,
  isAction,
  isScope,
  isWithinCeiling,
  type AccountType,
  type Scope,
} from '@tapcrm/contracts';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { ConflictError, NotFoundError } from '../../platform/http/error-handler.js';

export interface UserEffectivePolicy {
  action: string;
  allowed: boolean;
  scope: string;
  fields: string[] | null;
  constraints: string[] | null;
  source: 'position' | 'override';
  overrideReason?: string | null;
  overrideExpiresAt?: string | null;
}

export interface UserEffectiveAccessResponse {
  user: {
    id: string;
    fullName: string;
    email: string | null;
    accountType: string;
    positionId: string | null;
    positionName: string | null;
    departmentId: string | null;
    departmentName: string | null;
    teamId: string | null;
    teamName: string | null;
    status: string;
  };
  effectivePolicies: UserEffectivePolicy[];
  positionPolicies: Array<{
    action: string;
    allowed: boolean;
    scope: string;
  }>;
  activeOverrides: Array<{
    id: string;
    action: string;
    allowed: boolean;
    scope: string;
    reason: string;
    expiresAt: string | null;
    grantedAt: string;
  }>;
  globalAccess: boolean;
  subordinates: Array<{
    id: string;
    fullName: string;
    email: string | null;
    positionName: string | null;
    departmentName: string | null;
    teamName: string | null;
  }>;
  reachableModules: string[];
}

export interface WhoCanItem {
  userId: string;
  fullName: string;
  email: string | null;
  positionId: string | null;
  positionName: string | null;
  departmentName: string | null;
  source: 'position' | 'override';
  scope: string;
  allowed: boolean;
  reason?: string | null;
  expiresAt?: string | null;
}

export interface UserOverrideRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  action: string;
  allowed: boolean;
  scope: string;
  fields: string[] | null;
  constraints: string[] | null;
  reason: string;
  grantedBy: string;
  grantedByName: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  isExpired: boolean;
  ageDays: number;
}

export interface RoleChangeRequestRecord {
  id: string;
  subjectUserId: string;
  subjectUserName: string;
  subjectUserEmail: string | null;
  fromPositionId: string | null;
  fromPositionName: string | null;
  toPositionId: string;
  toPositionName: string;
  toDepartmentName: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface RegistryActionRecord {
  action: string;
  module: string;
  resource: string | null;
  domain: string;
  sensitive: boolean;
  approvalBearing: boolean;
  initiatorField: string | null;
  positionGrantable: boolean;
  delegationAllowed: boolean;
  superAdminOnly: boolean;
  description: string;
}

interface RegistryActionDbRow {
  action: string;
  module: string;
  resource: string | null;
  domain: string;
  sensitive: boolean;
  approval_bearing: boolean;
  initiator_field: string | null;
  position_grantable: boolean;
  delegation_allowed: boolean;
  super_admin_only: boolean;
  description: string | null;
}

/* ==================================================================== *
 * Delegation guards
 * ==================================================================== */

async function readEffectivePolicy(
  ctx: RequestContext,
  action: string,
): Promise<{ allowed: boolean; scope: Scope } | null> {
  if (ctx.principal.accountType !== 'employee') return null;

  const overrides = await db.query<{ allowed: boolean; scope: string }>(
    ctx,
    sql`
      SELECT allowed, scope
      FROM user_override
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${ctx.principal.id}
        AND action = ${action}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY granted_at DESC
      LIMIT 1
    `,
  );

  const row =
    overrides[0] ??
    (
      await db.query<{ allowed: boolean; scope: string }>(
        ctx,
        sql`
          SELECT allowed, scope
          FROM position_policy
          WHERE organization_id = ${ctx.organizationId}
            AND position_id = ${ctx.principal.positionId}
            AND action = ${action}
          LIMIT 1
        `,
      )
    )[0];

  if (!row || !isScope(row.scope)) return null;
  return { allowed: row.allowed, scope: row.scope };
}

async function assertOverrideGrantAllowed(
  ctx: RequestContext,
  data: { userId: string; action: string; scope: string },
): Promise<void> {
  if (!isAction(data.action)) {
    throw new ConflictError(`Unknown action "${data.action}" cannot be granted.`);
  }

  const definition = REGISTRY[data.action];

  if (!definition.grantPolicy.positionGrantable) {
    throw new ConflictError(
      `${data.action} is protected and cannot be granted through Access Management.`,
      'protected_capability',
    );
  }

  if (!isScope(data.scope)) {
    throw new ConflictError(`Invalid override scope "${data.scope}".`);
  }

  if (data.scope === 'all-people' && definition.domain === 'business') {
    throw new ConflictError(
      `${data.action} is a business-domain action and cannot use the all-people scope.`,
      'domain_mismatch',
    );
  }

  if (globalAccess(ctx.principal)) return;

  if (!definition.grantPolicy.delegationAllowed) {
    throw new ConflictError(
      `${data.action} may only be granted by Super Admin.`,
      'super_admin_only',
    );
  }

  const delegatePolicy = await readEffectivePolicy(ctx, 'access:delegate');
  if (!delegatePolicy?.allowed) {
    throw new ConflictError(
      'The acting principal does not hold an active access:delegate policy.',
      'delegation_not_allowed',
    );
  }

  const actionPolicy = await readEffectivePolicy(ctx, data.action);
  if (!actionPolicy?.allowed) {
    throw new ConflictError(
      `The acting principal does not hold ${data.action}, so it cannot be delegated.`,
      'delegation_ceiling',
    );
  }

  if (!isWithinCeiling(data.scope, actionPolicy.scope)) {
    throw new ConflictError(
      `The requested ${data.scope} scope is wider than the acting principal's ${actionPolicy.scope} ceiling.`,
      'delegation_ceiling',
    );
  }

  if (!isWithinCeiling(data.scope, delegatePolicy.scope)) {
    throw new ConflictError(
      `The requested ${data.scope} scope is wider than the acting principal's ${delegatePolicy.scope} delegation ceiling.`,
      'delegation_ceiling',
    );
  }

  if (ctx.principal.accountType !== 'employee') {
    throw new ConflictError(
      'Only an employee principal can delegate scoped access.',
      'delegation_not_allowed',
    );
  }

  const targets = await db.query<{
    id: string;
    accountType: string;
    departmentId: string | null;
    teamId: string | null;
    organizationalLevel: number;
  }>(
    ctx,
    sql`
      SELECT
        u.id,
        u.account_type,
        u.department_id,
        u.team_id,
        p.organizational_level
      FROM app_user u
      JOIN position p ON p.id = u.position_id
      WHERE u.organization_id = ${ctx.organizationId}
        AND u.id = ${data.userId}
        AND u.status = 'active'
    `,
  );

  const target = targets[0];
  if (!target) throw new NotFoundError(`Target user "${data.userId}" not found.`);
  if (target.id === ctx.principal.id) {
    throw new ConflictError(
      'A delegation target must be another user.',
      'delegation_boundary',
    );
  }
  if (target.accountType !== 'employee') {
    throw new ConflictError(
      'Scoped delegation targets active employees only.',
      'delegation_boundary',
    );
  }
  if (target.organizationalLevel >= ctx.principal.organizationalLevel) {
    throw new ConflictError(
      'Delegation targets must be at a strictly lower organizational level.',
      'delegation_seniority',
    );
  }

  let insideBoundary = false;
  switch (delegatePolicy.scope) {
    case 'department':
      insideBoundary = target.departmentId === ctx.principal.departmentId;
      break;
    case 'team': {
      if (ctx.principal.teamId !== null) {
        const teams = await db.query<{ id: string }>(
          ctx,
          sql`
            WITH RECURSIVE team_tree AS (
              SELECT id
              FROM team
              WHERE organization_id = ${ctx.organizationId}
                AND id = ${ctx.principal.teamId}
              UNION ALL
              SELECT child.id
              FROM team child
              JOIN team_tree parent ON child.parent_team_id = parent.id
              WHERE child.organization_id = ${ctx.organizationId}
            )
            SELECT id FROM team_tree
          `,
        );
        insideBoundary = teams.some((team) => team.id === target.teamId);
      }
      break;
    }
    case 'pool':
      insideBoundary =
        ctx.principal.teamId !== null && target.teamId === ctx.principal.teamId;
      break;
    case 'own':
      insideBoundary = false;
      break;
    case 'all-people':
      insideBoundary = true;
      break;
    default:
      insideBoundary = false;
  }

  if (!insideBoundary) {
    throw new ConflictError(
      "The target user is outside the acting principal's delegation boundary.",
      'delegation_boundary',
    );
  }
}


// ?hello
/* ==================================================================== *
 * Service Functions
 * ==================================================================== */

export async function getEffectivePoliciesForUser(
  ctx: RequestContext,
  userId: string,
): Promise<UserEffectiveAccessResponse> {
  const users = await db.query<{
    id: string;
    fullName: string;
    email: string | null;
    accountType: string;
    positionId: string | null;
    positionName: string | null;
    departmentId: string | null;
    departmentName: string | null;
    teamId: string | null;
    teamName: string | null;
    status: string;
  }>(
    ctx,
    sql`
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.account_type,
        u.position_id,
        p.name AS position_name,
        u.department_id,
        d.name AS department_name,
        u.team_id,
        t.name AS team_name,
        u.status
      FROM app_user u
      LEFT JOIN position p ON p.id = u.position_id
      LEFT JOIN department d ON d.id = u.department_id
      LEFT JOIN team t ON t.id = u.team_id
      WHERE u.organization_id = ${ctx.organizationId}
        AND u.id = ${userId}
    `,
  );

  const user = users[0];
  if (!user) {
    throw new NotFoundError(`User "${userId}" not found.`);
  }

  // 1. Position policies
  let positionPolicies: Array<{
    action: string;
    allowed: boolean;
    scope: string;
    fields: string[] | null;
    constraints: string[] | null;
  }> = [];

  if (user.positionId) {
    positionPolicies = await db.query(
      ctx,
      sql`
        SELECT action, allowed, scope, fields, constraints
        FROM position_policy
        WHERE organization_id = ${ctx.organizationId}
          AND position_id = ${user.positionId}
        ORDER BY action ASC
      `,
    );
  }

  // 2. Active user overrides (not expired and not revoked)
  const activeOverrides = await db.query<{
    id: string;
    action: string;
    allowed: boolean;
    scope: string;
    fields: string[] | null;
    constraints: string[] | null;
    reason: string;
    expiresAt: string | null;
    grantedAt: string;
  }>(
    ctx,
    sql`
      SELECT
        id,
        action,
        allowed,
        scope,
        fields,
        constraints,
        reason,
        expires_at,
        granted_at
      FROM user_override
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${userId}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY granted_at DESC
    `,
  );

  // 3. Compute effective policies (override replaces position policy for that action)
  const overrideMap = new Map<string, (typeof activeOverrides)[0]>();
  for (const ov of activeOverrides) {
    if (!overrideMap.has(ov.action)) {
      overrideMap.set(ov.action, ov);
    }
  }

  const effectiveMap = new Map<string, UserEffectivePolicy>();

  for (const pp of positionPolicies) {
    effectiveMap.set(pp.action, {
      action: pp.action,
      allowed: pp.allowed,
      scope: pp.scope,
      fields: pp.fields,
      constraints: pp.constraints,
      source: 'position',
    });
  }

  for (const [action, ov] of overrideMap.entries()) {
    effectiveMap.set(action, {
      action: ov.action,
      allowed: ov.allowed,
      scope: ov.scope,
      fields: ov.fields,
      constraints: ov.constraints,
      source: 'override',
      overrideReason: ov.reason,
      overrideExpiresAt: ov.expiresAt,
    });
  }

  const effectivePolicies = Array.from(effectiveMap.values()).sort((a, b) =>
    a.action.localeCompare(b.action),
  );

  const subordinates = await db.query<{
    id: string;
    fullName: string;
    email: string | null;
    positionName: string | null;
    departmentName: string | null;
    teamName: string | null;
  }>(
    ctx,
    sql`
      WITH RECURSIVE subordinate_tree AS (
        SELECT id
        FROM app_user
        WHERE organization_id = ${ctx.organizationId}
          AND reports_to = ${userId}
          AND status = 'active'

        UNION ALL

        SELECT child.id
        FROM app_user child
        JOIN subordinate_tree parent ON child.reports_to = parent.id
        WHERE child.organization_id = ${ctx.organizationId}
          AND child.status = 'active'
      )
      SELECT
        u.id,
        u.full_name,
        u.email,
        p.name AS position_name,
        d.name AS department_name,
        t.name AS team_name
      FROM subordinate_tree s
      JOIN app_user u ON u.id = s.id
      LEFT JOIN position p ON p.id = u.position_id
      LEFT JOIN department d ON d.id = u.department_id
      LEFT JOIN team t ON t.id = u.team_id
      ORDER BY u.full_name ASC
    `,
  );

  const registry = await listRegistryActions();
  const isGlobal = globalAccess({ accountType: user.accountType as AccountType });
  const heldActions = new Set(
    effectivePolicies.filter((policy) => policy.allowed).map((policy) => policy.action),
  );
  const reachableModules = registry
    .filter((action) => isGlobal || heldActions.has(action.action))
    .map((action) => action.module)
    .filter((module, index, modules) => modules.indexOf(module) === index)
    .sort();

  return {
    user,
    effectivePolicies,
    positionPolicies,
    activeOverrides,
    globalAccess: isGlobal,
    subordinates,
    reachableModules,
  };
}

export async function getWhoCanPerformAction(
  ctx: RequestContext,
  action: string,
): Promise<WhoCanItem[]> {
  // Query users who have an active override for this action
  const overrideHolders = await db.query<{
    userId: string;
    fullName: string;
    email: string | null;
    positionId: string | null;
    positionName: string | null;
    departmentName: string | null;
    scope: string;
    allowed: boolean;
    reason: string;
    expiresAt: string | null;
  }>(
    ctx,
    sql`
      SELECT
        u.id AS user_id,
        u.full_name,
        u.email,
        u.position_id,
        p.name AS position_name,
        d.name AS department_name,
        uo.scope,
        uo.allowed,
        uo.reason,
        uo.expires_at
      FROM user_override uo
      JOIN app_user u ON u.id = uo.user_id
      LEFT JOIN position p ON p.id = u.position_id
      LEFT JOIN department d ON d.id = u.department_id
      WHERE uo.organization_id = ${ctx.organizationId}
        AND u.organization_id = ${ctx.organizationId}
        AND uo.action = ${action}
        AND uo.revoked_at IS NULL
        AND (uo.expires_at IS NULL OR uo.expires_at > now())
        AND u.status = 'active'
    `,
  );

  const latestOverrides = new Map<string, (typeof overrideHolders)[number]>();
  for (const holder of overrideHolders) {
    if (!latestOverrides.has(holder.userId)) {
      latestOverrides.set(holder.userId, holder);
    }
  }
  const overrideUserIds = new Set(latestOverrides.keys());

  // Query users whose position default policy grants this action (and who have no override for this action)
  const positionHolders = await db.query<{
    userId: string;
    fullName: string;
    email: string | null;
    positionId: string | null;
    positionName: string | null;
    departmentName: string | null;
    scope: string;
    allowed: boolean;
  }>(
    ctx,
    sql`
      SELECT
        u.id AS user_id,
        u.full_name,
        u.email,
        u.position_id,
        p.name AS position_name,
        d.name AS department_name,
        pp.scope,
        pp.allowed
      FROM position_policy pp
      JOIN app_user u ON u.position_id = pp.position_id
      JOIN position p ON p.id = pp.position_id
      LEFT JOIN department d ON d.id = u.department_id
      WHERE pp.organization_id = ${ctx.organizationId}
        AND u.organization_id = ${ctx.organizationId}
        AND pp.action = ${action}
        AND pp.allowed = true
        AND u.status = 'active'
    `,
  );

  const results: WhoCanItem[] = [];

  for (const oh of latestOverrides.values()) {
    if (oh.allowed) {
      results.push({
        userId: oh.userId,
        fullName: oh.fullName,
        email: oh.email,
        positionId: oh.positionId,
        positionName: oh.positionName,
        departmentName: oh.departmentName,
        source: 'override',
        scope: oh.scope,
        allowed: oh.allowed,
        reason: oh.reason,
        expiresAt: oh.expiresAt,
      });
    }
  }

  for (const ph of positionHolders) {
    if (!overrideUserIds.has(ph.userId)) {
      results.push({
        userId: ph.userId,
        fullName: ph.fullName,
        email: ph.email,
        positionId: ph.positionId,
        positionName: ph.positionName,
        departmentName: ph.departmentName,
        source: 'position',
        scope: ph.scope,
        allowed: ph.allowed,
      });
    }
  }

  return results.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function listUserOverrides(
  ctx: RequestContext,
): Promise<UserOverrideRecord[]> {
  return await db.query<UserOverrideRecord>(
    ctx,
    sql`
      SELECT
        uo.id,
        uo.user_id,
        u.full_name AS user_name,
        u.email AS user_email,
        uo.action,
        uo.allowed,
        uo.scope,
        uo.fields,
        uo.constraints,
        uo.reason,
        uo.granted_by,
        granter.full_name AS granted_by_name,
        uo.granted_at,
        uo.expires_at,
        uo.revoked_at,
        (uo.expires_at IS NOT NULL AND uo.expires_at <= now()) AS is_expired,
        ROUND(EXTRACT(EPOCH FROM (now() - uo.granted_at)) / 86400) AS age_days
      FROM user_override uo
      JOIN app_user u ON u.id = uo.user_id
      JOIN app_user granter ON granter.id = uo.granted_by
      WHERE uo.organization_id = ${ctx.organizationId}
        AND u.organization_id = ${ctx.organizationId}
      ORDER BY uo.granted_at DESC
    `,
  );
}

export async function createUserOverride(
  ctx: RequestContext,
  data: {
    userId: string;
    action: string;
    allowed: boolean;
    scope: string;
    fields?: string[] | null | undefined;
    constraints?: string[] | null | undefined;
    reason: string;
    expiresAt?: string | null | undefined;
  },
): Promise<{ id: string }> {
  await assertOverrideGrantAllowed(ctx, data);

  const targetUsers = await db.query(
    ctx,
    sql`
      SELECT id
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${data.userId}
        AND status = 'active'
    `,
  );
  if (targetUsers.length === 0) {
    throw new NotFoundError(`Target user "${data.userId}" not found.`);
  }

  return await db.transaction(ctx, async (tx) => {
    const rows = await tx.query<{ id: string }>(
      sql`
        INSERT INTO user_override (
          organization_id,
          user_id,
          action,
          allowed,
          scope,
          fields,
          constraints,
          reason,
          granted_by,
          granted_at,
          expires_at
        ) VALUES (
          ${ctx.organizationId},
          ${data.userId},
          ${data.action},
          ${data.allowed},
          ${data.scope},
          ${data.fields ?? null},
          ${data.constraints ?? null},
          ${data.reason},
          ${ctx.principal.id},
          now(),
          ${data.expiresAt ? new Date(data.expiresAt).toISOString() : null}
        )
        RETURNING id
      `,
    );

    await tx.query(
      sql`
        UPDATE app_user
        SET session_version = session_version + 1, updated_at = now()
        WHERE id = ${data.userId}
      `,
    );

    await tx.query(
      sql`
        INSERT INTO audit_outbox (organization_id, stream, payload)
        VALUES (
          ${ctx.organizationId},
          'access',
          ${JSON.stringify({
            action: 'access:delegate',
            targetType: 'userOverride',
            targetId: rows[0]!.id,
            kind: 'override-granted',
            userId: data.userId,
            capability: data.action,
            allowed: data.allowed,
            scope: data.scope,
            reason: data.reason,
            expiresAt: data.expiresAt ?? null,
          })}::jsonb
        )
      `,
    );

    return rows[0]!;
  });
}

export async function revokeUserOverride(
  ctx: RequestContext,
  overrideId: string,
): Promise<void> {
  const overrides = await db.query<{ id: string; userId: string }>(
    ctx,
    sql`
      SELECT id, user_id
      FROM user_override
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${overrideId}
        AND revoked_at IS NULL
    `,
  );

  const override = overrides[0];
  if (!override) {
    throw new NotFoundError(`Active override "${overrideId}" not found.`);
  }

  await db.transaction(ctx, async (tx) => {
    await tx.query(
      sql`
        UPDATE user_override
        SET revoked_at = now()
        WHERE id = ${overrideId}
      `,
    );

    await tx.query(
      sql`
        UPDATE app_user
        SET session_version = session_version + 1, updated_at = now()
        WHERE id = ${override.userId}
      `,
    );

    await tx.query(
      sql`
        INSERT INTO audit_outbox (organization_id, stream, payload)
        VALUES (
          ${ctx.organizationId},
          'access',
          ${JSON.stringify({
            action: 'access:delegate',
            targetType: 'userOverride',
            targetId: overrideId,
            kind: 'override-revoked',
            userId: override.userId,
          })}::jsonb
        )
      `,
    );
  });
}

export async function listRoleChangeRequests(
  ctx: RequestContext,
): Promise<RoleChangeRequestRecord[]> {
  return await db.query<RoleChangeRequestRecord>(
    ctx,
    sql`
      SELECT
        rcr.id,
        rcr.subject_user_id,
        u.full_name AS subject_user_name,
        u.email AS subject_user_email,
        rcr.from_position_id,
        fp.name AS from_position_name,
        rcr.to_position_id,
        tp.name AS to_position_name,
        d.name AS to_department_name,
        rcr.requested_by,
        req.full_name AS requested_by_name,
        rcr.requested_at,
        rcr.reason,
        rcr.status,
        rcr.decided_by,
        dec.full_name AS decided_by_name,
        rcr.decided_at,
        rcr.decision_reason
      FROM role_change_request rcr
      JOIN app_user u ON u.id = rcr.subject_user_id
      LEFT JOIN position fp ON fp.id = rcr.from_position_id
      JOIN position tp ON tp.id = rcr.to_position_id
      JOIN department d ON d.id = tp.department_id
      JOIN app_user req ON req.id = rcr.requested_by
      LEFT JOIN app_user dec ON dec.id = rcr.decided_by
      WHERE rcr.organization_id = ${ctx.organizationId}
      ORDER BY rcr.requested_at DESC
    `,
  );
}

export async function createRoleChangeRequest(
  ctx: RequestContext,
  data: {
    subjectUserId: string;
    toPositionId: string;
    reason: string;
  },
): Promise<{ id: string }> {
  const users = await db.query<{ id: string; positionId: string | null }>(
    ctx,
    sql`
      SELECT id, position_id
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${data.subjectUserId}
        AND status = 'active'
    `,
  );
  const user = users[0];
  if (!user) {
    throw new NotFoundError(`Subject user "${data.subjectUserId}" not found.`);
  }

  const positions = await db.query<{ id: string; name: string }>(
    ctx,
    sql`
      SELECT id, name
      FROM position
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${data.toPositionId}
        AND status = 'active'
    `,
  );
  if (positions.length === 0) {
    throw new NotFoundError(`Target position "${data.toPositionId}" not found.`);
  }

  const rows = await db.transaction(ctx, async (tx) => {
    const created = await tx.query<{ id: string }>(
      sql`
        INSERT INTO role_change_request (
          organization_id,
          subject_user_id,
          from_position_id,
          to_position_id,
          requested_by,
          requested_at,
          reason,
          status
        ) VALUES (
          ${ctx.organizationId},
          ${data.subjectUserId},
          ${user.positionId},
          ${data.toPositionId},
          ${ctx.principal.id},
          now(),
          ${data.reason},
          'pending'
        )
        RETURNING id
      `,
    );

    await tx.query(
      sql`
        INSERT INTO audit_outbox (organization_id, stream, payload)
        VALUES (
          ${ctx.organizationId},
          'access',
          ${JSON.stringify({
            action: 'access:request-role-change',
            targetType: 'roleChangeRequest',
            targetId: created[0]!.id,
            kind: 'role-change-request-created',
            subjectUserId: data.subjectUserId,
            toPositionId: data.toPositionId,
            reason: data.reason,
          })}::jsonb
        )
      `,
    );

    return created;
  });

  return rows[0]!;
}

export async function decideRoleChangeRequest(
  ctx: RequestContext,
  requestId: string,
  data: {
    status: 'approved' | 'rejected';
    decisionReason?: string | undefined;
  },
): Promise<void> {
  const requests = await db.query<{
    id: string;
    subjectUserId: string;
    toPositionId: string;
    requestedBy: string;
    status: string;
  }>(
    ctx,
    sql`
      SELECT id, subject_user_id, to_position_id, requested_by, status
      FROM role_change_request
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${requestId}
    `,
  );

  const request = requests[0];
  if (!request) {
    throw new NotFoundError(`Role change request "${requestId}" not found.`);
  }

  if (request.status !== 'pending') {
    throw new ConflictError(`Role change request has already been ${request.status}.`);
  }

  // Segregation of Duties (A1 / RG-4): Requester cannot decide their own request
  if (request.requestedBy === ctx.principal.id) {
    throw new ConflictError(
      'Segregation of Duties (A1) violation: An actor cannot approve or reject a role change request they initiated.',
    );
  }

  await db.transaction(ctx, async (tx) => {
    // 1. Update request status
    await tx.query(
      sql`
        UPDATE role_change_request
        SET
          status = ${data.status},
          decided_by = ${ctx.principal.id},
          decided_at = now(),
          decision_reason = ${data.decisionReason ?? null}
        WHERE id = ${requestId}
          AND organization_id = ${ctx.organizationId}
      `,
    );

    // 2. If approved, apply position change, clear existing overrides (AM-8), and bump session_version
    if (data.status === 'approved') {
      const positions = await tx.query<{ departmentId: string }>(
        sql`
          SELECT department_id
          FROM position
          WHERE organization_id = ${ctx.organizationId}
            AND id = ${request.toPositionId}
        `,
      );
      const newDeptId = positions[0]?.departmentId;

      await tx.query(
        sql`
          UPDATE app_user
          SET
            position_id = ${request.toPositionId},
            department_id = ${newDeptId ?? null},
            session_version = session_version + 1,
            updated_at = now()
          WHERE organization_id = ${ctx.organizationId}
            AND id = ${request.subjectUserId}
        `,
      );

      // AM-8: "Changing a user's position clears their overrides, since an override is relative to a position."
      await tx.query(
        sql`
          UPDATE user_override
          SET revoked_at = now()
          WHERE organization_id = ${ctx.organizationId}
            AND user_id = ${request.subjectUserId}
            AND revoked_at IS NULL
        `,
      );
    }

    await tx.query(
      sql`
        INSERT INTO audit_outbox (organization_id, stream, payload)
        VALUES (
          ${ctx.organizationId},
          'access',
          ${JSON.stringify({
            action: 'access:decide-role-change',
            targetType: 'roleChangeRequest',
            targetId: requestId,
            kind:
              data.status === 'approved'
                ? 'role-change-approved'
                : 'role-change-rejected',
            status: data.status,
            subjectUserId: request.subjectUserId,
            toPositionId: request.toPositionId,
            reason: data.decisionReason ?? null,
          })}::jsonb
        )
      `,
    );
  });
}

export async function listTenantUsers(ctx: RequestContext): Promise<
  Array<{
    id: string;
    fullName: string;
    email: string | null;
    accountType: string;
    positionName: string | null;
  }>
> {
  return await db.query(
    ctx,
    sql`
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.account_type,
        p.name AS position_name
      FROM app_user u
      LEFT JOIN position p ON p.id = u.position_id
      WHERE u.organization_id = ${ctx.organizationId}
        AND u.status = 'active'
      ORDER BY (CASE WHEN u.account_type = 'super-admin' THEN 0 ELSE 1 END), u.full_name ASC
    `,
  );
}

export async function listTenantPositions(ctx: RequestContext): Promise<
  Array<{
    id: string;
    code: string;
    name: string;
    departmentId: string;
    departmentName: string;
    organizationalLevel: number;
    status: string;
  }>
> {
  return await db.query(
    ctx,
    sql`
      SELECT
        p.id,
        p.code,
        p.name,
        p.department_id,
        d.name AS department_name,
        p.organizational_level,
        p.status
      FROM position p
      JOIN department d ON d.id = p.department_id
      WHERE p.organization_id = ${ctx.organizationId}
        AND p.status = 'active'
      ORDER BY d.name ASC, p.organizational_level DESC, p.name ASC
    `,
  );
}

export async function listRegistryActions(): Promise<RegistryActionRecord[]> {
  const pool = (await import('../../platform/dal/pool.js')).getPool();
  const res = await pool.query<RegistryActionDbRow>(
    `SELECT
      action,
      module,
      resource,
      domain,
      sensitive,
      approval_bearing,
      initiator_field,
      position_grantable,
      delegation_allowed,
      super_admin_only,
      description
    FROM registry_action
    ORDER BY module ASC, action ASC`,
  );
  return res.rows.map((r) => ({
    action: r.action,
    module: r.module,
    resource: r.resource,
    domain: r.domain,
    sensitive: Boolean(r.sensitive),
    approvalBearing: Boolean(r.approval_bearing),
    initiatorField: r.initiator_field,
    positionGrantable: Boolean(r.position_grantable),
    delegationAllowed: Boolean(r.delegation_allowed),
    superAdminOnly: Boolean(r.super_admin_only),
    description: r.description || '',
  }));
}

/* ==================================================================== *
 * Approval Delegation
 *
 * AUTHORIZATION.md §7.1
 *
 * Four conditions:
 *
 * 1. LIMIT
 * 2. CAPABILITY
 * 3. SCOPE
 * 4. ORGANIZATIONAL BOUNDARY
 *
 * DG-2: one hop only
 * DG-6: delegation is time bounded
 * ==================================================================== */

export interface ApprovalDelegationRecord {
  id: string;

  delegatorUserId: string;
  delegatorName: string;

  delegateUserId: string;
  delegateName: string;

  startAt: string;
  endAt: string;

  reason: string;

  dealValueMax: string | null;
  discountPercentMax: string | null;
  allowsCustomTerms: boolean;

  createdAt: string;
  revokedAt: string | null;

  active: boolean;
}

interface ApprovalPosition {
  id: string;
  organizationalLevel: number;
  departmentId: string | null;
  maxDealValue: number | null;
  maxDiscountPercent: number | null;
  allowsCustomTerms: boolean;
}

interface ApprovalUser {
  id: string;
  accountType: AccountType;
  status: string;
  positionId: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  organizationalLevel: number | null;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

async function getApprovalUser(
  ctx: RequestContext,
  userId: string,
): Promise<ApprovalUser> {
  const rows = await db.query<ApprovalUser>(
    ctx,
    sql`
      SELECT
        u.id,
        u.account_type AS "accountType",
        u.status,
        u.position_id AS "positionId",
        u.department_id AS "departmentId",
        u.team_id AS "teamId",
        u.reports_to AS "reportsTo",
        p.organizational_level AS "organizationalLevel"
      FROM app_user u
      LEFT JOIN position p
        ON p.organization_id = u.organization_id
       AND p.id = u.position_id
      WHERE u.organization_id = ${ctx.organizationId}
        AND u.id = ${userId}
    `,
  );

  const user = rows[0];

  if (!user) {
    throw new NotFoundError(
      `User "${userId}" not found.`,
    );
  }

  return user;
}

async function getApprovalPosition(
  ctx: RequestContext,
  positionId: string,
): Promise<ApprovalPosition> {
  const rows = await db.query<ApprovalPosition>(
    ctx,
    sql`
      SELECT
        id,
        organizational_level AS "organizationalLevel",
        department_id AS "departmentId",
        max_deal_value AS "maxDealValue",
        max_discount_percent AS "maxDiscountPercent",
        allows_custom_terms AS "allowsCustomTerms"
      FROM position
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${positionId}
        AND status = 'active'
    `,
  );

  const position = rows[0];

  if (!position) {
    throw new NotFoundError(
      `Position "${positionId}" not found.`,
    );
  }

  return position;
}

/**
 * Returns true when ancestorId is an ancestor of descendantId.
 *
 * The query is intentionally bounded to the same organization.
 */
async function isReportingAncestor(
  ctx: RequestContext,
  ancestorId: string,
  descendantId: string,
): Promise<boolean> {
  if (ancestorId === descendantId) {
    return false;
  }

  const rows = await db.query<{ id: string }>(
    ctx,
    sql`
      WITH RECURSIVE chain AS (
        SELECT
          id,
          reports_to
        FROM app_user
        WHERE organization_id = ${ctx.organizationId}
          AND id = ${descendantId}

        UNION ALL

        SELECT
          parent.id,
          parent.reports_to
        FROM app_user parent
        JOIN chain child
          ON child.reports_to = parent.id
        WHERE parent.organization_id = ${ctx.organizationId}
      )
      SELECT id
      FROM chain
      WHERE id = ${ancestorId}
      LIMIT 1
    `,
  );

  return rows.length > 0;
}

/**
 * DG-1 / DG-4.
 *
 * The delegate must be:
 *   - active employee
 *   - same department OR ancestor of delegator
 */
async function assertApprovalBoundary(
  ctx: RequestContext,
  delegator: ApprovalUser,
  delegate: ApprovalUser,
): Promise<void> {
  if (delegate.accountType !== 'employee') {
    throw new ConflictError(
      'Approval delegation is available only to employees.',
      'delegation_boundary',
    );
  }

  if (delegate.status !== 'active') {
    throw new ConflictError(
      'The approval delegate must be active.',
      'delegation_boundary',
    );
  }

  if (
    delegate.departmentId !== null &&
    delegator.departmentId !== null &&
    delegate.departmentId === delegator.departmentId
  ) {
    return;
  }

  const ancestor = await isReportingAncestor(
    ctx,
    delegate.id,
    delegator.id,
  );

  if (!ancestor) {
    throw new ConflictError(
      'Approval delegation requires the same department or an organizational ancestor.',
      'delegation_boundary',
    );
  }
}

/**
 * DG-2 — delegate cannot delegate onward.
 *
 * A user currently acting as a delegate cannot create another
 * delegation from delegated authority.
 */
async function assertNotDelegatedAuthority(
  ctx: RequestContext,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`
      SELECT id
      FROM approval_delegation
      WHERE organization_id = ${ctx.organizationId}
        AND delegate_user_id = ${ctx.principal.id}
        AND revoked_at IS NULL
        AND start_at <= now()
        AND end_at > now()
      LIMIT 1
    `,
  );

  if (rows.length > 0) {
    throw new ConflictError(
      'A delegated approver cannot delegate approval authority onward.',
      'delegation_one_hop',
    );
  }
}

/**
 * DG-1 / condition 2 — capability.
 *
 * Delegate must hold every approval-bearing action that the delegator
 * is delegating.
 *
 * We evaluate the registry rather than hard-coding approval actions.
 */
async function getApprovalCapabilities(
  ctx: RequestContext,
  user: ApprovalUser,
): Promise<Set<string>> {
  if (
    user.accountType === 'super-admin'
  ) {
    return new Set(
      Object.values(REGISTRY)
        .filter((definition) => definition.approvalBearing)
        .map((definition) => definition.action),
    );
  }

  if (
    user.accountType !== 'employee' ||
    user.positionId === null
  ) {
    return new Set();
  }

  const rows = await db.query<{ action: string }>(
    ctx,
    sql`
      SELECT pp.action
      FROM position_policy pp
      WHERE pp.organization_id = ${ctx.organizationId}
        AND pp.position_id = ${user.positionId}
        AND pp.allowed = true
    `,
  );

  const overrides = await db.query<{
    action: string;
    allowed: boolean;
  }>(
    ctx,
    sql`
      SELECT DISTINCT ON (action)
        action,
        allowed
      FROM user_override
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${user.id}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY action, granted_at DESC
    `,
  );

  const result = new Set<string>(
    rows
      .map((row) => row.action)
      .filter((action) => {
        const definition = REGISTRY[action as keyof typeof REGISTRY];

        return (
          definition !== undefined &&
          definition.approvalBearing
        );
      }),
  );

  for (const override of overrides) {
    const definition =
      REGISTRY[
        override.action as keyof typeof REGISTRY
      ];

    if (
      definition?.approvalBearing === true
    ) {
      if (override.allowed) {
        result.add(override.action);
      } else {
        result.delete(override.action);
      }
    }
  }

  return result;
}

/**
 * DG-1 / condition 3 — scope.
 *
 * Delegate's effective approval scope must cover the delegator's scope.
 *
 * For a delegation we compare the approval action policies one by one.
 */
async function assertApprovalScopeCoverage(
  ctx: RequestContext,
  delegator: ApprovalUser,
  delegate: ApprovalUser,
): Promise<void> {
  if (
    delegator.accountType === 'super-admin'
  ) {
    return;
  }

  if (
    delegator.positionId === null
  ) {
    throw new ConflictError(
      'The delegator has no position and therefore no approval policy.',
      'delegation_capability',
    );
  }

  const delegatorPolicies = await db.query<{
    action: string;
    scope: string;
  }>(
    ctx,
    sql`
      SELECT action, scope
      FROM position_policy
      WHERE organization_id = ${ctx.organizationId}
        AND position_id = ${delegator.positionId}
        AND allowed = true
    `,
  );

  const delegatePolicies = await db.query<{
    action: string;
    scope: string;
  }>(
    ctx,
    sql`
      SELECT action, scope
      FROM position_policy
      WHERE organization_id = ${ctx.organizationId}
        AND position_id = ${delegate.positionId}
        AND allowed = true
    `,
  );

  const delegateMap = new Map(
    delegatePolicies.map((policy) => [
      policy.action,
      policy.scope,
    ]),
  );

  for (const policy of delegatorPolicies) {
    const definition =
      REGISTRY[
        policy.action as keyof typeof REGISTRY
      ];

    if (
      definition?.approvalBearing !== true
    ) {
      continue;
    }

    const delegateScope =
      delegateMap.get(policy.action);

    if (!delegateScope) {
      throw new ConflictError(
        `Delegate does not hold approval capability "${policy.action}".`,
        'delegation_capability',
      );
    }

    if (
      !isScope(delegateScope) ||
      !isScope(policy.scope)
    ) {
      throw new ConflictError(
        `Invalid approval scope for "${policy.action}".`,
        'delegation_scope',
      );
    }

    if (
      !isWithinCeiling(
        policy.scope,
        delegateScope,
      )
    ) {
      throw new ConflictError(
        `Delegate scope for "${policy.action}" does not cover the delegator's scope.`,
        'delegation_scope',
      );
    }
  }
}

/**
 * DG-1 / condition 1 — approval limits.
 *
 * The delegate must be at least as capable as the delegator.
 */
async function assertApprovalLimitCoverage(
  ctx: RequestContext,
  delegator: ApprovalUser,
  delegate: ApprovalUser,
): Promise<ApprovalPosition | null> {
  if (
    delegator.positionId === null ||
    delegate.positionId === null
  ) {
    return null;
  }

  const delegatorPosition =
    await getApprovalPosition(
      ctx,
      delegator.positionId,
    );

  const delegatePosition =
    await getApprovalPosition(
      ctx,
      delegate.positionId,
    );

  const delegatorDeal =
    delegatorPosition.maxDealValue ?? 0;

  const delegateDeal =
    delegatePosition.maxDealValue ?? 0;

  if (delegateDeal < delegatorDeal) {
    throw new ConflictError(
      'Delegate deal approval limit is lower than the delegator approval limit.',
      'delegation_limit',
    );
  }

  const delegatorDiscount =
    delegatorPosition.maxDiscountPercent ?? 0;

  const delegateDiscount =
    delegatePosition.maxDiscountPercent ?? 0;

  if (delegateDiscount < delegatorDiscount) {
    throw new ConflictError(
      'Delegate discount approval limit is lower than the delegator approval limit.',
      'delegation_limit',
    );
  }

  if (
    delegatorPosition.allowsCustomTerms &&
    !delegatePosition.allowsCustomTerms
  ) {
    throw new ConflictError(
      'Delegate cannot approve custom terms at the delegator authority level.',
      'delegation_limit',
    );
  }

  return delegatePosition;
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

export async function listApprovalDelegations(
  ctx: RequestContext,
): Promise<ApprovalDelegationRecord[]> {
  return db.query<ApprovalDelegationRecord>(
    ctx,
    sql`
      SELECT
        d.id,

        d.delegator_user_id AS "delegatorUserId",
        delegator.full_name AS "delegatorName",

        d.delegate_user_id AS "delegateUserId",
        delegate.full_name AS "delegateName",

        d.start_at AS "startAt",
        d.end_at AS "endAt",

        d.reason,

        d.deal_value_max AS "dealValueMax",
        d.discount_percent_max AS "discountPercentMax",
        d.allows_custom_terms AS "allowsCustomTerms",

        d.created_at AS "createdAt",
        d.revoked_at AS "revokedAt",

        (
          d.revoked_at IS NULL
          AND d.start_at <= now()
          AND d.end_at > now()
        ) AS active

      FROM approval_delegation d

      JOIN app_user delegator
        ON delegator.organization_id = d.organization_id
       AND delegator.id = d.delegator_user_id

      JOIN app_user delegate
        ON delegate.organization_id = d.organization_id
       AND delegate.id = d.delegate_user_id

      WHERE d.organization_id = ${ctx.organizationId}

      ORDER BY d.start_at DESC
    `,
  );
}

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

export async function createApprovalDelegation(
  ctx: RequestContext,
  data: {
    delegateUserId: string;
    startAt: string;
    endAt: string;
    reason: string;
  },
): Promise<ApprovalDelegationRecord> {
  await assertNotDelegatedAuthority(ctx);

  const start = new Date(data.startAt);
  const end = new Date(data.endAt);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    throw new ConflictError(
      'Invalid delegation dates.',
      'delegation_time',
    );
  }

  if (end <= start) {
    throw new ConflictError(
      'Delegation end time must be after start time.',
      'delegation_time',
    );
  }

  const maximumDuration =
    366 * 24 * 60 * 60 * 1000;

  if (
    end.getTime() - start.getTime() >
    maximumDuration
  ) {
    throw new ConflictError(
      'Approval delegation cannot exceed one year.',
      'delegation_time',
    );
  }

  const delegator =
    await getApprovalUser(
      ctx,
      ctx.principal.id,
    );

  const delegate =
    await getApprovalUser(
      ctx,
      data.delegateUserId,
    );

  if (
    delegator.id === delegate.id
  ) {
    throw new ConflictError(
      'A user cannot delegate approval authority to themselves.',
      'delegation_boundary',
    );
  }

  await assertApprovalBoundary(
    ctx,
    delegator,
    delegate,
  );

  await assertApprovalLimitCoverage(
    ctx,
    delegator,
    delegate,
  );

  await assertApprovalScopeCoverage(
    ctx,
    delegator,
    delegate,
  );

  const capabilitySet =
    await getApprovalCapabilities(
      ctx,
      delegate,
    );

  const delegatorCapabilities =
    await getApprovalCapabilities(
      ctx,
      delegator,
    );

  for (
    const action of delegatorCapabilities
  ) {
    const definition =
      REGISTRY[
        action as keyof typeof REGISTRY
      ];

    if (
      definition?.approvalBearing !== true
    ) {
      continue;
    }

    if (
      !capabilitySet.has(action)
    ) {
      throw new ConflictError(
        `Delegate does not hold required approval capability "${action}".`,
        'delegation_capability',
      );
    }
  }

  const overlap = await db.query<{ id: string }>(
    ctx,
    sql`
      SELECT id
      FROM approval_delegation
      WHERE organization_id = ${ctx.organizationId}
        AND delegator_user_id = ${ctx.principal.id}
        AND delegate_user_id = ${data.delegateUserId}
        AND revoked_at IS NULL
        AND start_at < ${end.toISOString()}
        AND end_at > ${start.toISOString()}
      LIMIT 1
    `,
  );

  if (overlap.length > 0) {
    throw new ConflictError(
      'An overlapping approval delegation already exists.',
      'delegation_overlap',
    );
  }

  let dealValueMax: number | null = null;
  let discountPercentMax: number | null = null;
  let allowsCustomTerms = false;

  if (
    delegator.positionId !== null &&
    delegate.positionId !== null
  ) {
    const position =
      await getApprovalPosition(
        ctx,
        delegate.positionId,
      );

    dealValueMax =
      position.maxDealValue;

    discountPercentMax =
      position.maxDiscountPercent;

    allowsCustomTerms =
      position.allowsCustomTerms;
  }

  const created = await db.transaction(
    ctx,
    async (tx) => {
      const rows = await tx.query<{
        id: string;
      }>(
        sql`
          INSERT INTO approval_delegation (
            organization_id,
            delegator_user_id,
            delegate_user_id,
            start_at,
            end_at,
            reason,
            deal_value_max,
            discount_percent_max,
            allows_custom_terms
          )
          VALUES (
            ${ctx.organizationId},
            ${ctx.principal.id},
            ${data.delegateUserId},
            ${start.toISOString()},
            ${end.toISOString()},
            ${data.reason},
            ${dealValueMax},
            ${discountPercentMax},
            ${allowsCustomTerms}
          )
          RETURNING id
        `,
      );

      await tx.query(
        sql`
          INSERT INTO audit_outbox (
            organization_id,
            stream,
            payload
          )
          VALUES (
            ${ctx.organizationId},
            'access',
            ${JSON.stringify({
              action: 'approvals:delegate',
              targetType: 'approvalDelegation',
              targetId: rows[0]!.id,
              kind: 'approval-delegation-created',
              delegatorUserId: ctx.principal.id,
              delegateUserId: data.delegateUserId,
              startAt: start.toISOString(),
              endAt: end.toISOString(),
              reason: data.reason,
            })}::jsonb
          )
        `,
      );

      return rows[0]!;
    },
  );

  const records =
    await listApprovalDelegations(ctx);

  const result =
    records.find(
      (record) =>
        record.id === created.id,
    );

  if (!result) {
    throw new Error(
      'Approval delegation was created but could not be reloaded.',
    );
  }

  return result;
}

/* ------------------------------------------------------------------ *
 * Revoke
 * ------------------------------------------------------------------ */

export async function revokeApprovalDelegation(
  ctx: RequestContext,
  delegationId: string,
  reason?: string,
): Promise<void> {
  const rows = await db.query<{
    id: string;
    delegatorUserId: string;
    delegateUserId: string;
    revokedAt: string | null;
  }>(
    ctx,
    sql`
      SELECT
        id,
        delegator_user_id AS "delegatorUserId",
        delegate_user_id AS "delegateUserId",
        revoked_at AS "revokedAt"
      FROM approval_delegation
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${delegationId}
    `,
  );

  const delegation = rows[0];

  if (!delegation) {
    throw new NotFoundError(
      `Approval delegation "${delegationId}" not found.`,
    );
  }

  if (
    delegation.revokedAt !== null
  ) {
    throw new ConflictError(
      'Approval delegation has already been revoked.',
      'delegation_state',
    );
  }

  /*
   * Only the delegator or Super Admin may revoke.
   *
   * The route itself is protected by approvals:delegate.
   */
  if (
    !globalAccess(ctx.principal) &&
    delegation.delegatorUserId !== ctx.principal.id
  ) {
    throw new ConflictError(
      'Only the delegator or Super Admin can revoke this approval delegation.',
      'delegation_boundary',
    );
  }

  await db.transaction(
    ctx,
    async (tx) => {
      await tx.query(
        sql`
          UPDATE approval_delegation
          SET revoked_at = now()
          WHERE organization_id = ${ctx.organizationId}
            AND id = ${delegationId}
        `,
      );

      await tx.query(
        sql`
          INSERT INTO audit_outbox (
            organization_id,
            stream,
            payload
          )
          VALUES (
            ${ctx.organizationId},
            'access',
            ${JSON.stringify({
              action: 'approvals:delegate',
              targetType: 'approvalDelegation',
              targetId: delegationId,
              kind: 'approval-delegation-revoked',
              delegatorUserId:
                delegation.delegatorUserId,
              delegateUserId:
                delegation.delegateUserId,
              reason: reason ?? null,
            })}::jsonb
          )
        `,
      );
    },
  );
}

/* ------------------------------------------------------------------ *
 * Permission Delivery
 *
 * AUTHORIZATION.md §8
 * GET /api/me/permissions
 * ------------------------------------------------------------------ */

export interface MePermissionsResponse {
  accountType: AccountType;

  position: {
    id: string;
    code: string;
    name: string;
    organizationalLevel: number;
  } | null;

  department: {
    id: string;
    code: string;
    name: string;
  } | null;

  team: {
    id: string;
    name: string;
    kind: string;
  } | null;

  policies: Record<
    string,
    {
      allowed: boolean;
      scope: string;
      fields: string[] | null;
      constraints: string[] | null;
    }
  >;

  overrides: string[];

  approvalLimits: {
    dealValueMax: string | null;
    discountPercentMax: string | null;
    allowCustomTerms: boolean;
  };

  protectedNotes: Record<string, string>;

  fieldRestrictions: Record<string, string[]>;

  subordinateCount: number;

  globalAccess: boolean;
}

export async function getMyPermissions(
  ctx: RequestContext,
): Promise<MePermissionsResponse> {
  const principal =
    await getApprovalUser(
      ctx,
      ctx.principal.id,
    );

  let position:
    MePermissionsResponse['position'] =
      null;

  let department:
    MePermissionsResponse['department'] =
      null;

  let team:
    MePermissionsResponse['team'] =
      null;

  const policies: MePermissionsResponse['policies'] =
    {};

  const overrides: string[] = [];

  const approvalLimits =
    {
      dealValueMax: null,
      discountPercentMax: null,
      allowCustomTerms: false,
    };

  if (
    principal.positionId !== null
  ) {
    const rows = await db.query<{
      id: string;
      code: string;
      name: string;
      organizationalLevel: number;
      maxDealValue: string | null;
      maxDiscountPercent: string | null;
      allowsCustomTerms: boolean;
    }>(
      ctx,
      sql`
        SELECT
          p.id,
          p.code,
          p.name,
          p.organizational_level AS "organizationalLevel",
          p.max_deal_value AS "maxDealValue",
          p.max_discount_percent AS "maxDiscountPercent",
          p.allows_custom_terms AS "allowsCustomTerms"
        FROM position p
        WHERE p.organization_id = ${ctx.organizationId}
          AND p.id = ${principal.positionId}
      `,
    );

    const row = rows[0];

    if (row) {
      position = {
        id: row.id,
        code: row.code,
        name: row.name,
        organizationalLevel:
          row.organizationalLevel,
      };

      const approvalLimits: {
        dealValueMax: string | null;
        discountPercentMax: string | null;
        allowCustomTerms: boolean;
      } = {
        dealValueMax: null,
        discountPercentMax: null,
        allowCustomTerms: false,
      };
    }
  }

  if (
    principal.departmentId !== null
  ) {
    const rows = await db.query<{
      id: string;
      code: string;
      name: string;
    }>(
      ctx,
      sql`
        SELECT id, code, name
        FROM department
        WHERE organization_id = ${ctx.organizationId}
          AND id = ${principal.departmentId}
      `,
    );

    if (rows[0]) {
      department = rows[0];
    }
  }

  if (
    principal.teamId !== null
  ) {
    const rows = await db.query<{
      id: string;
      name: string;
      kind: string;
    }>(
      ctx,
      sql`
        SELECT id, name, kind
        FROM team
        WHERE organization_id = ${ctx.organizationId}
          AND id = ${principal.teamId}
      `,
    );

    if (rows[0]) {
      team = rows[0];
    }
  }

  if (
    principal.accountType === 'employee' &&
    principal.positionId !== null
  ) {
    const positionPolicies =
      await db.query<{
        action: string;
        allowed: boolean;
        scope: string;
        fields: string[] | null;
        constraints: string[] | null;
      }>(
        ctx,
        sql`
          SELECT
            action,
            allowed,
            scope,
            fields,
            constraints
          FROM position_policy
          WHERE organization_id = ${ctx.organizationId}
            AND position_id = ${principal.positionId}
        `,
      );

    for (
      const policy of positionPolicies
    ) {
      policies[policy.action] = {
        allowed: policy.allowed,
        scope: policy.scope,
        fields: policy.fields,
        constraints:
          policy.constraints,
      };
    }

    const activeOverrides =
      await db.query<{
        action: string;
        allowed: boolean;
        scope: string;
        fields: string[] | null;
        constraints: string[] | null;
      }>(
        ctx,
        sql`
          SELECT DISTINCT ON (action)
            action,
            allowed,
            scope,
            fields,
            constraints
          FROM user_override
          WHERE organization_id = ${ctx.organizationId}
            AND user_id = ${ctx.principal.id}
            AND revoked_at IS NULL
            AND (
              expires_at IS NULL
              OR expires_at > now()
            )
          ORDER BY action, granted_at DESC
        `,
      );

    for (
      const override of activeOverrides
    ) {
      policies[override.action] = {
        allowed:
          override.allowed,
        scope:
          override.scope,
        fields:
          override.fields,
        constraints:
          override.constraints,
      };

      overrides.push(
        override.action,
      );
    }
  }

  const subordinateRows =
    await db.query<{ count: string }>(
      ctx,
      sql`
        WITH RECURSIVE tree AS (
          SELECT id
          FROM app_user
          WHERE organization_id = ${ctx.organizationId}
            AND reports_to = ${ctx.principal.id}
            AND status = 'active'

          UNION ALL

          SELECT child.id
          FROM app_user child
          JOIN tree parent
            ON child.reports_to = parent.id
          WHERE child.organization_id = ${ctx.organizationId}
            AND child.status = 'active'
        )
        SELECT COUNT(*)::text AS count
        FROM tree
      `,
    );

  return {
    accountType:
      ctx.principal.accountType,

    position,

    department,

    team,

    policies,

    overrides:
      [...new Set(overrides)].sort(),

    approvalLimits,

    protectedNotes: {
      'payroll:view':
        'Module access does not automatically expose individual payslips.',
      'access:view':
        'Employee permission policies and overrides remain subject to access-view authorization.',
    },

    fieldRestrictions: {
      employee: [
        'compensation',
        'statutoryIdentifiers',
        'bankDetails',
        'permissionPolicies',
        'overrides',
      ],
      payslip: [
        'monetaryFields',
      ],
      deal: [
        'commercials',
      ],
    },

    subordinateCount:
      Number(subordinateRows[0]?.count ?? 0),

    globalAccess:
      globalAccess(ctx.principal),
  };
}