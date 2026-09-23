import {
  ACTIONS,
  REGISTRY,
  actionDescription,
  actionScreens,
  globalAccess,
  isAction,
  isScopeDefinedForDomain,
  isScope,
  protectedCapabilityReason,
  type Action,
  type PermissionPolicy,
  type Principal,
  type Scope,
} from '@tapcrm/contracts';
import { authorize, effectivePolicy } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { scopeResolver } from '../../platform/authz-adapter.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { userResource } from '../identity/security/unlock.js';
import { validateManagerAssignment } from '../organization/reporting/service.js';
import { assertDelegationAllowed } from './delegation.js';
import { ACCESS_ERROR_CODES, AccessNotFoundError, AccessValidationError } from './errors.js';
import {
  enqueueAccessAudit,
  findAccessSubject,
  findDelegationTarget,
  insertOverride,
  listActiveOverrides,
  listOverrideOverview,
  listCapabilityHolders,
  listSubordinateUsers,
  revokeOverrideRow,
  createRoleChangeRequest,
  lockRoleChangeRequest,
  findPositionForRoleChange,
  applyRoleChange,
  decideRoleChange as decideRoleChangeRecord,
  clearActiveOverridesForPositionChange,
  listRoleChangeRequests,
  type ActiveOverrideRecord,
  type AccessSubjectRecord,
  type CapabilityHolderRecord,
  type OverrideOverviewRecord,
  type RoleChangeRequestRecord,
} from './repository.js';

export interface RoleChangeRequestView {
  readonly id: string;
  readonly subject: { readonly id: string; readonly fullName: string; readonly email: string | null };
  readonly fromPosition: { readonly id: string; readonly name: string | null } | null;
  readonly toPosition: { readonly id: string; readonly name: string | null };
  readonly requestedReportsTo: { readonly id: string; readonly name: string | null } | null;
  readonly requestedBy: { readonly id: string; readonly fullName: string };
  readonly reason: string;
  readonly status: RoleChangeRequestRecord['status'];
  readonly requestedAt: Date;
  readonly decidedAt: Date | null;
  readonly decisionReason: string | null;
}

function roleChangeRequestView(row: RoleChangeRequestRecord): RoleChangeRequestView {
  return {
    id: row.id,
    subject: { id: row.subjectUserId, fullName: row.subjectName, email: row.subjectEmail },
    fromPosition: row.fromPositionId
      ? { id: row.fromPositionId, name: row.fromPositionName }
      : null,
    toPosition: { id: row.toPositionId, name: row.toPositionName },
    requestedReportsTo: row.requestedReportsTo
      ? { id: row.requestedReportsTo, name: row.requestedReportsToName }
      : null,
    requestedBy: { id: row.requestedBy, fullName: row.requesterName },
    reason: row.reason,
    status: row.status,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    decisionReason: row.decisionReason,
  };
}

export interface EffectiveAccessRow {
  readonly action: Action;
  readonly module: string;
  readonly description: string;
  readonly screens: readonly string[];
  readonly allowed: boolean;
  readonly scope: Scope | null;
  readonly fields: readonly string[] | null;
  readonly constraints: readonly string[] | null;
  readonly source: 'position' | 'override' | 'super-admin' | 'none';
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly override: {
    readonly id: string;
    readonly reason: string;
    readonly grantedBy: string;
    readonly grantedAt: Date;
    readonly expiresAt: Date | null;
  } | null;
}

export interface AccessExplorerSubject {
  readonly id: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly accountType: AccessSubjectRecord['accountType'];
  readonly position: { readonly id: string; readonly name: string | null } | null;
  readonly department: { readonly id: string; readonly name: string | null } | null;
  readonly team: { readonly id: string; readonly name: string | null } | null;
}

export interface AccessExplorerResult {
  readonly subject: AccessExplorerSubject;
  readonly policies: readonly EffectiveAccessRow[];
  readonly subordinateIds: readonly string[];
  readonly subordinates: readonly AccessExplorerSubject[];
  /** Allowed actions are intersected with the shared client navigation map. */
  readonly reachableActions: readonly Action[];
}

export interface CapabilityHolder {
  readonly user: {
    readonly id: string;
    readonly fullName: string;
    readonly email: string | null;
    readonly accountType: 'employee' | 'super-admin';
  };
  readonly organization: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  };
  readonly position: { readonly id: string; readonly name: string | null } | null;
  readonly source: 'position' | 'override' | 'super-admin';
  readonly scope: Scope | null;
  readonly fields: readonly string[] | null;
  readonly reason: string;
  readonly override: {
    readonly id: string;
    readonly grantedBy: string;
    readonly grantedAt: Date;
    readonly expiresAt: Date | null;
  } | null;
}

export interface OverrideOverviewItem {
  readonly id: string;
  readonly user: { readonly id: string; readonly fullName: string; readonly email: string | null };
  readonly organization: { readonly id: string; readonly code: string; readonly name: string };
  readonly position: { readonly id: string; readonly name: string | null } | null;
  readonly action: Action;
  readonly allowed: boolean;
  readonly scope: Scope;
  readonly fields: readonly string[] | null;
  readonly reason: string;
  readonly grantedBy: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly ageDays: number;
  readonly reviewRequired: boolean;
  readonly positionHolderCount: number;
  readonly matchingOverrideCount: number;
  readonly recommendPositionPolicy: boolean;
}

function scopeMatchesViewer(row: { id: string; departmentId: string | null; teamId: string | null }, viewerId: string, scope: Scope, departmentId: string | null, teamIds: ReadonlySet<string>, poolIds: ReadonlySet<string>): boolean {
  switch (scope) {
    case 'all-people': return true;
    case 'department': return departmentId !== null && row.departmentId === departmentId;
    case 'team': return row.teamId !== null && teamIds.has(row.teamId);
    case 'pool': return poolIds.has(row.id);
    case 'own':
    case 'participant':
    default: return row.id === viewerId;
  }
}

function subjectView(subject: AccessSubjectRecord): AccessExplorerSubject {
  return {
    id: subject.id,
    fullName: subject.fullName,
    email: subject.email,
    accountType: subject.accountType,
    position: subject.positionId
      ? { id: subject.positionId, name: subject.positionName }
      : null,
    department: subject.departmentId
      ? { id: subject.departmentId, name: subject.departmentName }
      : null,
    team: subject.teamId ? { id: subject.teamId, name: subject.teamName } : null,
  };
}

function subjectPrincipal(subject: AccessSubjectRecord): Principal {
  const base = {
    id: subject.id,
    organizationId: subject.organizationId,
    sessionVersion: 0,
  };
  switch (subject.accountType) {
    case 'super-admin':
      return { ...base, accountType: 'super-admin' };
    case 'employee':
      return {
        ...base,
        accountType: 'employee',
        positionId: subject.positionId ?? '',
        departmentId: subject.departmentId ?? '',
        teamId: subject.teamId,
        reportsTo: subject.reportsTo,
        organizationalLevel: subject.organizationalLevel ?? 0,
      };
    case 'client':
      return { ...base, accountType: 'client', clientId: '' };
    case 'service':
      return {
        ...base,
        accountType: 'service',
        allowedActions: [],
        allowedResources: [],
        expiresAt: new Date(0),
      };
  }
}

function subjectContext(ctx: RequestContext, subject: AccessSubjectRecord): RequestContext {
  return { ...ctx, principal: subjectPrincipal(subject), memo: new Map() };
}

async function filterCapabilityHoldersToViewer(
  ctx: RequestContext,
  rows: readonly CapabilityHolderRecord[],
): Promise<readonly CapabilityHolderRecord[]> {
  if (globalAccess(ctx.principal)) return rows;
  const policy = await effectivePolicy(ctx, 'access:view');
  if (policy === null || !policy.allowed) return [];

  switch (policy.scope) {
    case 'all-people':
      return rows;
    case 'department': {
      const departmentId = await scopeResolver.departmentId(ctx);
      return departmentId === null
        ? []
        : rows.filter((row) => row.departmentId === departmentId);
    }
    case 'team': {
      const teamIds = await scopeResolver.teamIds(ctx);
      return rows.filter((row) => row.teamId !== null && teamIds.has(row.teamId));
    }
    case 'pool': {
      const poolMemberIds = await scopeResolver.poolMemberIds(ctx);
      return rows.filter((row) => poolMemberIds.has(row.id));
    }
    case 'own':
    case 'participant':
    default:
      return rows.filter((row) => row.id === ctx.principal.id);
  }
}

async function filterOverrideOverviewToViewer(
  ctx: RequestContext,
  rows: readonly OverrideOverviewRecord[],
): Promise<readonly OverrideOverviewRecord[]> {
  if (globalAccess(ctx.principal)) return rows;
  const policy = await effectivePolicy(ctx, 'access:view');
  if (policy === null || !policy.allowed) return [];
  const departmentId = policy.scope === 'department' ? await scopeResolver.departmentId(ctx) : null;
  const teamIds = policy.scope === 'team' ? await scopeResolver.teamIds(ctx) : new Set<string>();
  const poolIds = policy.scope === 'pool' ? await scopeResolver.poolMemberIds(ctx) : new Set<string>();
  return rows.filter((row) => scopeMatchesViewer(row, ctx.principal.id, policy.scope, departmentId, teamIds, poolIds));
}

/** Pure AM-10 projection: advisory only, never a policy mutation. */
export function buildOverrideOverviewItem(row: OverrideOverviewRecord): OverrideOverviewItem {
  return {
    id: row.id,
    user: { id: row.userId, fullName: row.fullName, email: row.email },
    organization: { id: row.organizationId, code: row.organizationCode, name: row.organizationName },
    position: row.positionId ? { id: row.positionId, name: row.positionName } : null,
    action: row.action,
    allowed: row.allowed,
    scope: row.scope,
    fields: row.fields,
    reason: row.reason,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
    ageDays: row.ageDays,
    reviewRequired: row.reviewRequired,
    positionHolderCount: row.positionHolderCount,
    matchingOverrideCount: row.matchingOverrideCount,
    recommendPositionPolicy: row.positionHolderCount > 0 && row.matchingOverrideCount * 100 > row.positionHolderCount * 30,
  };
}

export async function getOverrideOverview(ctx: RequestContext): Promise<{ overrides: readonly OverrideOverviewItem[] }> {
  const rows = await filterOverrideOverviewToViewer(ctx, await listOverrideOverview(ctx));
  return { overrides: rows.map(buildOverrideOverviewItem) };
}

export interface DelegationOption {
  readonly action: Action;
  readonly scopes: readonly Scope[];
  /** Existing policy field metadata available for optional narrowing. */
  readonly fields: readonly string[] | null;
  readonly canGrant: boolean;
  readonly reason: string | null;
}

/**
 * AM-11: this is a read-only, server-authoritative preview for the delegation
 * form. It exercises the exact same four-constraint guard as the write path;
 * the client never reimplements ceiling, boundary, or seniority rules.
 */
export async function getDelegationOptions(
  ctx: RequestContext,
  targetUserId: string,
): Promise<{ targetUserId: string; options: readonly DelegationOption[] }> {
  const target = await findDelegationTarget(ctx, targetUserId);
  if (target === null) throw new AccessNotFoundError(ACCESS_ERROR_CODES.USER_NOT_FOUND, 'User not found');
  const targetSubject = await findAccessSubject(ctx, targetUserId);
  const targetContext = targetSubject === null ? null : subjectContext(ctx, targetSubject);
  const scopes: readonly Scope[] = ['own', 'participant', 'pool', 'team', 'department', 'all-people'];
  const options = await Promise.all(ACTIONS.map(async (action) => {
    const definition = REGISTRY[action];
    const domain = definition.domain === 'derived' ? 'people' : definition.domain;
    const validScopes = scopes.filter((scope) => isScopeDefinedForDomain(scope, domain));
    const actorPolicy = await effectivePolicy(ctx, action);
    const targetPolicy = targetContext === null ? null : await effectivePolicy(targetContext, action);
    const fields = actorPolicy?.fields
      ? [...actorPolicy.fields]
      : targetPolicy?.fields
        ? [...targetPolicy.fields]
        : null;
    const allowedScopes: Scope[] = [];
    let firstFailure: string | null = null;
    for (const scope of validScopes) {
      try {
        await assertDelegationAllowed(
          evaluationContext(ctx),
          { action, allowed: true, scope, fields: null },
          target,
        );
        allowedScopes.push(scope);
      } catch (error) {
        if (firstFailure === null) {
          firstFailure = error instanceof Error ? error.message : 'Delegation constraint not satisfied';
        }
      }
    }
    return {
      action,
      scopes: allowedScopes,
      fields,
      canGrant: allowedScopes.length > 0,
      reason: allowedScopes.length > 0 ? null : firstFailure ?? 'No valid scope is available',
    } satisfies DelegationOption;
  }));
  return { targetUserId, options };
}

function policyRow(
  action: Action,
  policy: PermissionPolicy | null,
  override: ActiveOverrideRecord | undefined,
  global: boolean,
): EffectiveAccessRow {
  const definition = REGISTRY[action];
  const lockedReason = protectedCapabilityReason(definition);
  return {
    action,
    module: definition.module,
    description: actionDescription(definition),
    screens: actionScreens(definition),
    allowed: global ? true : policy?.allowed ?? false,
    scope: global ? null : policy?.scope ?? null,
    fields: policy?.fields ? [...policy.fields] : null,
    constraints: policy?.constraints ? [...policy.constraints] : null,
    source:
      global || policy?.source === undefined
        ? global
          ? 'super-admin'
          : 'none'
        : policy.source === 'position' || policy.source === 'override'
          ? policy.source
          : 'none',
    locked: lockedReason !== null,
    lockReason: lockedReason,
    override:
      override === undefined
        ? null
        : {
            id: override.id,
            reason: override.reason,
            grantedBy: override.grantedBy,
            grantedAt: override.grantedAt,
            expiresAt: override.expiresAt,
          },
  };
}

/** Pure projection used by AM-4 and its focused tests. */
export function buildEffectiveAccessRows(
  global: boolean,
  resolvedPolicies: ReadonlyMap<Action, PermissionPolicy | null>,
  overrides: readonly ActiveOverrideRecord[],
): EffectiveAccessRow[] {
  const overridesByAction = new Map(overrides.map((override) => [override.action, override]));
  return ACTIONS.map((action) =>
    policyRow(action, resolvedPolicies.get(action) ?? null, overridesByAction.get(action), global),
  );
}

export async function getEffectiveAccess(
  ctx: RequestContext,
  userId: string,
): Promise<AccessExplorerResult> {
  const subject = await findAccessSubject(ctx, userId);
  if (subject === null) {
    throw new AccessNotFoundError(ACCESS_ERROR_CODES.USER_NOT_FOUND, 'User not found');
  }

  const evaluatedContext = subjectContext(ctx, subject);
  const global = globalAccess(subjectPrincipal(subject));
  const overrides = global ? [] : await listActiveOverrides(ctx, userId);
  const resolvedPolicies = global
    ? new Map<Action, PermissionPolicy>()
    : new Map(
        await Promise.all(
          ACTIONS.map(async (action) => [
            action,
            await effectivePolicy(evaluatedContext, action),
          ] as const),
        ),
      );
  const policies = buildEffectiveAccessRows(global, resolvedPolicies, overrides);
  const subordinateSet = await scopeResolver.subordinateIds(evaluatedContext);
  const subordinateIds = [...subordinateSet].filter((id) => id !== subject.id);
  const subordinates = await listSubordinateUsers(ctx, subordinateIds);

  return {
    subject: subjectView(subject),
    policies,
    subordinateIds,
    subordinates: subordinates.map(subjectView),
    reachableActions: policies.filter((policy) => policy.allowed).map((policy) => policy.action),
  };
}

export async function getCapabilityHolders(
  ctx: RequestContext,
  actionName: string,
): Promise<{ action: Action; holders: readonly CapabilityHolder[] }> {
  if (!isAction(actionName)) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.UNKNOWN_ACTION,
      `"${actionName}" is not an action in the registry`,
      { unmet: ['known-action'] },
    );
  }
  const action = actionName;
  const rows = await filterCapabilityHoldersToViewer(
    ctx,
    await listCapabilityHolders(ctx, action),
  );
  return {
    action,
    holders: rows.map((row) => ({
      user: {
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        accountType: row.accountType,
      },
      organization: {
        id: row.organizationId,
        code: row.organizationCode,
        name: row.organizationName,
      },
      position: row.positionId ? { id: row.positionId, name: row.positionName } : null,
      source: row.source,
      scope: row.scope,
      fields: row.fields,
      reason: row.reason,
      override: row.overrideId
        ? {
            id: row.overrideId,
            grantedBy: row.grantedBy!,
            grantedAt: row.grantedAt!,
            expiresAt: row.expiresAt,
          }
        : null,
    })),
  };
}

export interface GrantOverrideInput {
  readonly userId: string;
  readonly action: string;
  readonly allowed: boolean;
  readonly scope: string;
  readonly fields: readonly string[] | null;
  readonly reason: string;
  readonly expiresAt: Date | null;
}

/**
 * AM-6 — an override is a full policy with a mandatory reason and an optional
 * expiry, not a boolean.
 *
 * The framework has already authorized `access:delegate` against the target
 * before this runs. What happens here is the §4.6 guard on the payload, then
 * the write and its audit record in one transaction.
 */
export async function grantOverride(
  ctx: RequestContext,
  input: GrantOverrideInput,
): Promise<{ id: string }> {
  if (!isAction(input.action)) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.UNKNOWN_ACTION,
      `"${input.action}" is not an action in the registry`,
      { unmet: ['known-action'] },
    );
  }
  if (!isScope(input.scope)) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.OVERRIDE_SCOPE_INVALID_FOR_DOMAIN,
      `"${input.scope}" is not a scope`,
      { unmet: ['known-scope'] },
    );
  }
  const reason = input.reason.trim();
  if (reason === '') {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.OVERRIDE_REASON_REQUIRED,
      'An override requires a reason (AM-6)',
      { unmet: ['reason'] },
    );
  }
  if (input.expiresAt !== null && input.expiresAt.getTime() <= Date.now()) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.OVERRIDE_EXPIRY_IN_PAST,
      'An override expiry must be in the future',
      { unmet: ['expiry'] },
    );
  }

  const target = await findDelegationTarget(ctx, input.userId);
  if (target === null) {
    throw new AccessNotFoundError(ACCESS_ERROR_CODES.USER_NOT_FOUND, 'User not found');
  }

  const action: Action = input.action;
  const scope: Scope = input.scope;

  await assertDelegationAllowed(
    evaluationContext(ctx),
    { action, allowed: input.allowed, scope, fields: input.fields },
    target,
  );

  return db.transaction(ctx, async (tx) => {
    const created = await insertOverride(tx, {
      organizationId: ctx.organizationId,
      userId: input.userId,
      action,
      allowed: input.allowed,
      scope,
      fields: input.fields,
      reason,
      grantedBy: ctx.principal.id,
      expiresAt: input.expiresAt,
    });
    for (const previous of created.replaced) {
      await enqueueAccessAudit(tx, ctx, {
        action: previous.expiresAt !== null && previous.expiresAt.getTime() <= Date.now()
          ? 'access.override_expired'
          : 'access.override_superseded',
        targetId: input.userId,
        before: { overrideId: previous.id, action: previous.action, scope: previous.scope },
        after: null,
        reason: 'Replaced by a newer override',
      });
    }
    await enqueueAccessAudit(tx, ctx, {
      action: 'access.override_granted',
      targetId: input.userId,
      before: null,
      after: {
        overrideId: created.id,
        action,
        allowed: input.allowed,
        scope,
        fields: input.fields ?? null,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      },
      reason,
    });
    return created;
  });
}

/** Revocation marks; it never deletes. AM-7: as auditable as the grant. */
export async function revokeOverride(
  ctx: RequestContext,
  overrideId: string,
): Promise<{ id: string; revoked: true }> {
  return db.transaction(ctx, async (tx) => {
    const revoked = await revokeOverrideRow(tx, ctx.organizationId, overrideId);
    if (revoked === null) {
      throw new AccessNotFoundError(
        ACCESS_ERROR_CODES.OVERRIDE_NOT_FOUND,
        'Override not found, or already revoked',
      );
    }
    await enqueueAccessAudit(tx, ctx, {
      action: 'access.override_revoked',
      targetId: revoked.userId,
      before: {
        overrideId: revoked.id,
        action: revoked.action,
        allowed: revoked.allowed,
        scope: revoked.scope,
      },
      after: null,
      reason: revoked.reason,
    });
    return { id: revoked.id, revoked: true as const };
  });
}

export interface RoleChangeRequestInput {
  readonly subjectUserId: string;
  readonly toPositionId: string;
  readonly requestedReportsTo?: string | null;
  readonly reason: string;
}

export async function getRoleChangeRequests(
  ctx: RequestContext,
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending',
): Promise<{ requests: readonly RoleChangeRequestView[] }> {
  if (!globalAccess(ctx.principal)) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.ROLE_CHANGE_NOT_AUTHORIZED,
      'Only the organization Super Admin can view role-change requests',
    );
  }
  const rows = await listRoleChangeRequests(ctx, status);
  return { requests: rows.map(roleChangeRequestView) };
}

/** The route authorization is the source of truth for this capability probe. */
export function getRoleChangeRequestAccess(): { canRequest: true } {
  return { canRequest: true };
}

export async function requestRoleChange(
  ctx: RequestContext,
  input: RoleChangeRequestInput,
): Promise<{ id: string; status: 'pending' }> {
  const reason = input.reason.trim();
  if (reason === '') {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.ROLE_CHANGE_REASON_REQUIRED,
      'A role change requires a reason',
    );
  }
  if (input.subjectUserId === ctx.principal.id) {
    throw new AccessValidationError(ACCESS_ERROR_CODES.ROLE_CHANGE_SELF, 'You cannot request a role change for yourself');
  }
  return db.transaction(ctx, async (tx) => {
    const subject = await tx.maybeOne<{
      id: string;
      positionId: string | null;
      positionCode: string | null;
      accountType: string;
      departmentId: string | null;
    }>(sql`
      SELECT u.id, u.position_id AS "positionId", p.code AS "positionCode",
             u.account_type AS "accountType",
             u.department_id AS "departmentId"
      FROM app_user u
      LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
      WHERE u.organization_id = ${ctx.organizationId} AND u.id = ${input.subjectUserId} AND u.status = 'active'
    `);
    const position = await findPositionForRoleChange(tx, ctx.organizationId, input.toPositionId);
    if (subject === null || subject.accountType !== 'employee' || position === null || position.status !== 'active') {
      throw new AccessValidationError(ACCESS_ERROR_CODES.ROLE_CHANGE_POSITION_INVALID, 'The role-change user or position is invalid');
    }

    // The canonical HR position may submit requests for every other employee
    // position, including HR Executive, but one HR holder must not submit a
    // role-change request for another holder of the same HR position.
    const requester = await tx.maybeOne<{ positionCode: string | null }>(sql`
      SELECT p.code AS "positionCode"
      FROM app_user u
      LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
      WHERE u.organization_id = ${ctx.organizationId} AND u.id = ${ctx.principal.id}
    `);
    if (requester?.positionCode === 'hr' && subject.positionCode === 'hr') {
      throw new AccessValidationError(
        ACCESS_ERROR_CODES.ROLE_CHANGE_HR_TARGET_FORBIDDEN,
        'An HR employee cannot request a role change for another HR employee',
      );
    }
    await validateManagerAssignment(tx, {
      organizationId: ctx.organizationId,
      subjectUserId: subject.id,
      subjectDepartmentId: position.departmentId,
      subjectPositionId: position.id,
      managerUserId: input.requestedReportsTo ?? null,
    });

    // The route-level action check has no target resource, so repeat the
    // capability check here for direct service callers. Then authorize the
    // submitted employee as the canonical people resource. HR's users:view
    // policy is all-people, which permits targets across this organization;
    // the target ID is never trusted merely because the request action exists.
    await authorize(ctx, 'access:request-role-change');
    const targetUser = await userResource(ctx, subject.id);
    if (targetUser === null) {
      throw new AccessValidationError(ACCESS_ERROR_CODES.USER_NOT_FOUND, 'User not found');
    }
    await authorize(ctx, 'users:view', targetUser);

    const created = await createRoleChangeRequest(tx, {
      organizationId: ctx.organizationId,
      subjectUserId: input.subjectUserId,
      fromPositionId: subject.positionId,
      toPositionId: input.toPositionId,
      requestedBy: ctx.principal.id,
      requestedReportsTo: input.requestedReportsTo ?? null,
      reason,
    });
    await enqueueAccessAudit(tx, ctx, {
      action: 'access.role_change_requested',
      targetId: input.subjectUserId,
      before: { positionId: subject.positionId },
      after: {
        requestId: created.id,
        positionId: input.toPositionId,
        reportsTo: input.requestedReportsTo ?? null,
      },
      reason,
    });
    return { id: created.id, status: 'pending' as const };
  });
}

export async function decideRoleChange(
  ctx: RequestContext,
  requestId: string,
  input: { readonly approved: boolean; readonly reason: string },
): Promise<{ id: string; status: 'approved' | 'rejected' }> {
  if (!globalAccess(ctx.principal)) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.ROLE_CHANGE_NOT_AUTHORIZED,
      'Only the organization Super Admin can decide a role change',
    );
  }
  const reason = input.reason.trim();
  if (reason === '') throw new AccessValidationError(ACCESS_ERROR_CODES.ROLE_CHANGE_REASON_REQUIRED, 'A decision requires a reason');
  return db.transaction(ctx, async (tx) => {
    const request = await lockRoleChangeRequest(tx, ctx.organizationId, requestId);
    if (request === null || request.status !== 'pending') {
      throw new AccessValidationError(ACCESS_ERROR_CODES.ROLE_CHANGE_NOT_PENDING, 'Role-change request is not pending');
    }
    if (request.requestedBy === ctx.principal.id) {
      throw new AccessValidationError(ACCESS_ERROR_CODES.ROLE_CHANGE_SELF, 'The requester cannot decide their own role change');
    }
    const status = input.approved ? 'approved' : 'rejected';
    if (!input.approved) {
      await decideRoleChangeRecord(tx, ctx.organizationId, requestId, status, ctx.principal.id, reason);
      await enqueueAccessAudit(tx, ctx, {
        action: 'access.role_change_rejected',
        targetId: request.subjectUserId,
        before: { requestId, positionId: request.fromPositionId },
        after: { status },
        reason,
      });
      return { id: requestId, status };
    }
    const position = await findPositionForRoleChange(tx, ctx.organizationId, request.toPositionId);
    if (position === null || position.status !== 'active') {
      throw new AccessValidationError(ACCESS_ERROR_CODES.ROLE_CHANGE_POSITION_INVALID, 'Target position is invalid or inactive');
    }
    await validateManagerAssignment(tx, {
      organizationId: ctx.organizationId,
      subjectUserId: request.subjectUserId,
      subjectDepartmentId: position.departmentId,
      subjectPositionId: position.id,
      managerUserId: request.requestedReportsTo,
    });
    await applyRoleChange(
      tx,
      ctx.organizationId,
      request.subjectUserId,
      position.id,
      position.departmentId,
      request.requestedReportsTo,
    );
    const cleared = await clearActiveOverridesForPositionChange(tx, ctx.organizationId, request.subjectUserId);
    for (const override of cleared) {
      await enqueueAccessAudit(tx, ctx, {
        action: 'access.override_cleared_position_change',
        targetId: request.subjectUserId,
        before: { overrideId: override.id, action: override.action, scope: override.scope },
        after: null,
        reason: 'Position changed; user overrides are position-relative',
      });
    }
    await decideRoleChangeRecord(tx, ctx.organizationId, requestId, status, ctx.principal.id, reason);
    await enqueueAccessAudit(tx, ctx, {
      action: 'access.role_change_approved',
      targetId: request.subjectUserId,
      before: { positionId: request.fromPositionId, requestId },
      after: {
        positionId: request.toPositionId,
        reportsTo: request.requestedReportsTo,
        overridesCleared: cleared.length,
      },
      reason,
    });
    return { id: requestId, status };
  });
}


/**
 * The guard needs a `PolicyEvaluationContext`: a RequestContext plus the scope
 * resolver. The platform layer already owns one and the engine is configured
 * with it, so the module borrows that rather than building a second resolver
 * that could answer differently.
 */
function evaluationContext(ctx: RequestContext) {
  return { ...ctx, scope: scopeResolver };
}
