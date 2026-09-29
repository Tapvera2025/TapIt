import { MATCH_ALL, effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import {
  REGISTRY,
  globalAccess,
  isPositionPolicyGrantable,
  isAction,
  isScopeDefinedForDomain,
  isWithinCeiling,
  type Action,
  type Scope,
} from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { findDepartment } from '../departments/repository.js';
import { enqueueOrganizationAudit } from '../repository.js';
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
  ORGANIZATION_ERROR_CODES,
} from '../errors.js';
import type {
  CreatePositionInput,
  UpdatePositionInput,
  UpdatePositionPoliciesInput,
} from '../validators.js';
import {
  assertPositionApprovalLimits,
  assertPositionLevel,
  buildPositionTree,
} from './hierarchy.js';
import {
  describePositionPolicyScopes,
  toPositionImpactPreview,
  toPositionInsertionImpactPreview,
  toPositionPolicyImpactPreview,
  type PositionScopeDescriptionContext,
} from './impact.js';
import {
  countActiveEmployees,
  countActiveEmployeesInDepartment,
  countActiveEmployeesInTeams,
  directPositionHolderIds,
  findChildren,
  findPosition,
  findPositionByCode,
  insertPosition,
  listActivePositionHolderPrincipals,
  listPositionHolders,
  listPositionsForDepartment,
  listPositionPolicies,
  listPositionPoliciesTx,
  listPositionsTx,
  loadPositionResource,
  positionImpact,
  positionInsertionImpact,
  enqueuePermissionsChanged,
  replacePositionPolicies,
  updatePositionParent,
  updatePosition,
  type PositionRecord,
} from './repository.js';
import { scopeResolver } from '../../../platform/authz-adapter.js';

const auditContext = (ctx: RequestContext) => ({
  organizationId: ctx.organizationId,
  actorId: ctx.principal.id,
  actorType: ctx.principal.accountType,
  requestId: ctx.requestId,
  sourceIp: ctx.sourceIp,
});

async function validatePosition(
  tx: Tx,
  ctx: RequestContext,
  input: {
    departmentId: string;
    organizationalLevel: number;
    parentPositionId: string | null;
    maxDealValue: number | null;
    maxDiscountPercent: number | null;
    allowsCustomTerms: boolean;
  },
  currentId?: string,
  allowRoot = false,
): Promise<void> {
  const department = await findDepartment(tx, ctx.organizationId, input.departmentId);
  if (!department || department.status !== 'active')
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_DEPARTMENT_INVALID,
      'Position department is invalid or inactive',
    );
  if (input.parentPositionId === null) {
    if (!allowRoot)
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.POSITION_CANNOT_BE_ROOT,
        'Custom positions must have a parent position',
      );
    return;
  }
  if (input.parentPositionId === currentId)
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_LEVEL_CONFLICT,
      'A position cannot be its own parent',
    );

  const parent = await findPosition(tx, ctx.organizationId, input.parentPositionId);
  if (!parent || parent.status !== 'active')
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_DEPARTMENT_INVALID,
      'Parent position is invalid or inactive',
    );
  if (parent.departmentId !== input.departmentId)
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_DEPARTMENT_INVALID,
      'Position and parent must belong to the same department',
    );
  const children =
    currentId === undefined
      ? []
      : await findChildren(tx, ctx.organizationId, currentId, currentId);
  assertPositionLevel({
    position: currentId ?? 'new-position',
    level: input.organizationalLevel,
    parent,
    children,
  });

  if (
    input.maxDealValue !== null &&
    parent.maxDealValue !== null &&
    input.maxDealValue > Number(parent.maxDealValue)
  ) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_LIMIT_EXCEEDED,
      `maxDealValue cannot exceed parent position ${parent.name}'s limit`,
      {
        field: 'maxDealValue',
        parentId: parent.id,
        parentLimit: parent.maxDealValue,
        requested: input.maxDealValue,
      },
    );
  }
  if (
    input.maxDiscountPercent !== null &&
    parent.maxDiscountPercent !== null &&
    input.maxDiscountPercent > Number(parent.maxDiscountPercent)
  ) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_LIMIT_EXCEEDED,
      `maxDiscountPercent cannot exceed parent position ${parent.name}'s limit`,
      {
        field: 'maxDiscountPercent',
        parentId: parent.id,
        parentLimit: parent.maxDiscountPercent,
        requested: input.maxDiscountPercent,
      },
    );
  }
  if (input.allowsCustomTerms && !parent.allowsCustomTerms) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_LIMIT_EXCEEDED,
      `allowsCustomTerms cannot exceed parent position ${parent.name}'s limit`,
      { field: 'allowsCustomTerms', parentId: parent.id },
    );
  }
}

export async function getPositionLadder(ctx: RequestContext, departmentCode: string) {
  const structurePolicy = await effectivePolicy(ctx, 'org:view-structure');
  const departmentFilter =
    structurePolicy?.allowed === true && structurePolicy.scope === 'department'
      ? MATCH_ALL
      : await visibilityFilter(ctx, 'org:view-structure', 'department');
  const department = await db.maybeOne<{ id: string; code: string; name: string }>(
    ctx,
    sql`
    SELECT id, code, name FROM department
    WHERE organization_id = ${ctx.organizationId}
      AND code = ${departmentCode}
      AND status = 'active'
      AND ${departmentFilter}
  `,
  );
  if (!department) return { department: null, positions: [], teams: [] };
  const [positions, teams] = await Promise.all([
    listPositionsForDepartment(ctx, department.id),
    db.query(
      ctx,
      sql`
      SELECT id, name, kind FROM team
      WHERE organization_id = ${ctx.organizationId} AND department_id = ${department.id}
      ORDER BY name
    `,
    ),
  ]);
  return { department, positions: buildPositionTree(positions), teams };
}

export async function createPosition(
  ctx: RequestContext,
  input: CreatePositionInput,
): Promise<PositionRecord> {
  return db.transaction(ctx, async (tx) => {
    const canCreateRoot =
      input.parentPositionId === null &&
      (await listPositionsTx(tx, ctx.organizationId, input.departmentId)).length === 0;
    const preview = await buildPositionInsertionPreview(tx, ctx, input);
    if (preview.positionParentChanges.length > 0 && !input.confirmImpact) {
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.POSITION_IMPACT_CONFIRMATION_REQUIRED,
        'Inserting a position requires explicit impact confirmation',
        preview,
      );
    }
    if (await findPositionByCode(tx, ctx.organizationId, input.code))
      throw new OrganizationConflictError(
        ORGANIZATION_ERROR_CODES.POSITION_CODE_EXISTS,
        `Position code "${input.code}" already exists`,
      );
    const values = {
      ...input,
      parentPositionId: input.parentPositionId,
      maxDealValue: input.maxDealValue ?? null,
      maxDiscountPercent: input.maxDiscountPercent ?? null,
    };
    await validatePosition(tx, ctx, values, undefined, canCreateRoot);
    const position = await insertPosition(tx, {
      organizationId: ctx.organizationId,
      ...values,
    });
    const reparented: Array<{ before: PositionRecord; after: PositionRecord }> = [];
    for (const change of preview.positionParentChanges) {
      const child = await findPosition(tx, ctx.organizationId, change.positionId);
      if (!child)
        throw new OrganizationNotFoundError(
          ORGANIZATION_ERROR_CODES.POSITION_NOT_FOUND,
          'Affected child position no longer exists',
        );
      const after = await updatePositionParent(tx, {
        organizationId: ctx.organizationId,
        id: child.id,
        parentPositionId: position.id,
      });
      reparented.push({ before: child, after });
    }
    await validatePositionGraph(tx, ctx.organizationId, input.departmentId);
    await enqueueOrganizationAudit(tx, {
      ...auditContext(ctx),
      action: 'organization.position.created',
      resourceType: 'position',
      resourceId: position.id,
      before: null,
      after: position,
    });
    for (const change of reparented) {
      await enqueueOrganizationAudit(tx, {
        ...auditContext(ctx),
        action: 'organization.position.reparented',
        resourceType: 'position',
        resourceId: change.after.id,
        before: change.before,
        after: change.after,
      });
    }
    if (preview.affectedHolderIds.length > 0) {
      await enqueuePermissionsChanged(tx, {
        organizationId: ctx.organizationId,
        positionId: position.id,
        holderIds: [...preview.affectedHolderIds],
        reason: 'position.hierarchy.inserted',
      });
    }
    return reparented.length === 0 ? position : { ...position, impact: preview };
  });
}

export async function previewCreatePosition(
  ctx: RequestContext,
  input: CreatePositionInput,
) {
  return db.transaction(ctx, async (tx) => buildPositionInsertionPreview(tx, ctx, input));
}

async function buildPositionInsertionPreview(
  tx: Tx,
  ctx: RequestContext,
  input: CreatePositionInput,
) {
  if (await findPositionByCode(tx, ctx.organizationId, input.code))
    throw new OrganizationConflictError(
      ORGANIZATION_ERROR_CODES.POSITION_CODE_EXISTS,
      `Position code "${input.code}" already exists`,
    );
  const values = {
    ...input,
    parentPositionId: input.parentPositionId,
    maxDealValue: input.maxDealValue ?? null,
    maxDiscountPercent: input.maxDiscountPercent ?? null,
  };
  const canCreateRoot =
    input.parentPositionId === null &&
    (await listPositionsTx(tx, ctx.organizationId, input.departmentId)).length === 0;
  await validatePosition(tx, ctx, values, undefined, canCreateRoot);
  const impact = await positionInsertionImpact(
    tx,
    ctx.organizationId,
    input.parentPositionId,
    input.organizationalLevel,
    null,
  );
  return toPositionInsertionImpactPreview(
    {
      code: input.code,
      name: input.name,
      departmentId: input.departmentId,
      organizationalLevel: input.organizationalLevel,
      parentPositionId: input.parentPositionId,
    },
    input.status === 'active'
      ? impact
      : {
          positionIds: [],
          holderIds: [],
          parentChanges: [],
          reportingRelationships: [],
        },
  );
}

async function validatePositionGraph(
  tx: Tx,
  organizationId: string,
  departmentId: string,
): Promise<void> {
  const positions = await listPositionsTx(tx, organizationId, departmentId);
  const byId = new Map(positions.map((position) => [position.id, position]));
  for (const position of positions) {
    if (position.status !== 'active') continue;
    const parent = position.parentPositionId
      ? (byId.get(position.parentPositionId) ?? null)
      : null;
    if (position.parentPositionId !== null && parent === null) {
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.POSITION_DEPARTMENT_INVALID,
        'Position parent must belong to the same department',
      );
    }
    if (parent !== null) {
      if (parent.departmentId !== position.departmentId || parent.status !== 'active') {
        throw new OrganizationValidationError(
          ORGANIZATION_ERROR_CODES.POSITION_DEPARTMENT_INVALID,
          'Position hierarchy cannot cross departments or inactive positions',
        );
      }
      assertPositionLevel({
        position: position.id,
        level: position.organizationalLevel,
        parent,
        children: [],
      });
    }
    const children = positions.filter(
      (candidate) =>
        candidate.parentPositionId === position.id && candidate.status === 'active',
    );
    assertPositionApprovalLimits({
      positionId: position.id,
      maxDealValue: position.maxDealValue === null ? null : Number(position.maxDealValue),
      maxDiscountPercent:
        position.maxDiscountPercent === null ? null : Number(position.maxDiscountPercent),
      allowsCustomTerms: position.allowsCustomTerms,
      children,
    });
    const path = new Set<string>();
    let cursor: PositionRecord | null = position;
    while (cursor !== null) {
      if (path.has(cursor.id)) {
        throw new OrganizationValidationError(
          ORGANIZATION_ERROR_CODES.POSITION_LEVEL_CONFLICT,
          'Position hierarchy cannot contain a cycle',
        );
      }
      path.add(cursor.id);
      cursor = cursor.parentPositionId
        ? (byId.get(cursor.parentPositionId) ?? null)
        : null;
    }
  }
}

export async function updatePositionById(
  ctx: RequestContext,
  id: string,
  input: UpdatePositionInput,
): Promise<PositionRecord> {
  return db.transaction(ctx, async (tx) => {
    const before = await findPosition(tx, ctx.organizationId, id);
    if (!before)
      throw new OrganizationNotFoundError(
        ORGANIZATION_ERROR_CODES.POSITION_NOT_FOUND,
        'Position not found',
      );
    if (
      before.isSeeded &&
      (input.departmentId !== undefined ||
        input.parentPositionId !== undefined ||
        input.organizationalLevel !== undefined)
    ) {
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.POSITION_SEEDED_IMMUTABLE,
        'Seeded position hierarchy and department cannot be changed',
      );
    }
    const next = {
      departmentId: input.departmentId ?? before.departmentId,
      name: input.name ?? before.name,
      organizationalLevel: input.organizationalLevel ?? before.organizationalLevel,
      parentPositionId:
        input.parentPositionId === undefined
          ? before.parentPositionId
          : input.parentPositionId,
      status: input.status ?? before.status,
      maxDealValue:
        input.maxDealValue === undefined
          ? before.maxDealValue === null
            ? null
            : Number(before.maxDealValue)
          : input.maxDealValue,
      maxDiscountPercent:
        input.maxDiscountPercent === undefined
          ? before.maxDiscountPercent === null
            ? null
            : Number(before.maxDiscountPercent)
          : input.maxDiscountPercent,
      allowsCustomTerms: input.allowsCustomTerms ?? before.allowsCustomTerms,
    };
    await validatePosition(tx, ctx, next, id, before.isSeeded);
    await validatePositionChildrenAgainstLimits(tx, ctx.organizationId, id, next);
    const hierarchyChanged =
      next.departmentId !== before.departmentId ||
      next.parentPositionId !== before.parentPositionId ||
      next.organizationalLevel !== before.organizationalLevel;
    const impact = hierarchyChanged
      ? toPositionImpactPreview(before, await positionImpact(tx, ctx.organizationId, id))
      : null;
    if (hierarchyChanged && !input.confirmImpact) {
      throw new OrganizationValidationError(
        ORGANIZATION_ERROR_CODES.POSITION_IMPACT_CONFIRMATION_REQUIRED,
        'Hierarchy changes require explicit impact confirmation',
        impact,
      );
    }
    const after = await updatePosition(tx, {
      organizationId: ctx.organizationId,
      id,
      ...next,
    });
    if (impact !== null) {
      await enqueuePermissionsChanged(tx, {
        organizationId: ctx.organizationId,
        positionId: id,
        holderIds: [...impact.affectedHolderIds],
        reason: 'position.hierarchy.changed',
      });
    }
    await enqueueOrganizationAudit(tx, {
      ...auditContext(ctx),
      action: 'organization.position.updated',
      resourceType: 'position',
      resourceId: id,
      before,
      after,
    });
    return impact === null ? after : { ...after, impact };
  });
}

async function validatePositionChildrenAgainstLimits(
  tx: Tx,
  organizationId: string,
  positionId: string,
  input: {
    maxDealValue: number | null;
    maxDiscountPercent: number | null;
    allowsCustomTerms: boolean;
  },
): Promise<void> {
  const children = await findChildren(tx, organizationId, positionId);
  assertPositionApprovalLimits({ ...input, positionId, children });
}

export async function getPositionHolders(ctx: RequestContext, positionId: string) {
  const position = await db.maybeOne<{ id: string }>(
    ctx,
    sql`
    SELECT id FROM position WHERE organization_id = ${ctx.organizationId} AND id = ${positionId}
  `,
  );
  if (!position)
    throw new OrganizationNotFoundError(
      ORGANIZATION_ERROR_CODES.POSITION_NOT_FOUND,
      'Position not found',
    );
  return listPositionHolders(
    ctx,
    positionId,
    await visibilityFilter(ctx, 'org:view-people', 'user'),
  );
}

export async function getPositionPolicies(ctx: RequestContext, positionId: string) {
  const position = await db.maybeOne<{ id: string }>(
    ctx,
    sql`
    SELECT id FROM position WHERE organization_id = ${ctx.organizationId} AND id = ${positionId}
  `,
  );
  if (!position)
    throw new OrganizationNotFoundError(
      ORGANIZATION_ERROR_CODES.POSITION_NOT_FOUND,
      'Position not found',
    );
  return listPositionPolicies(ctx, positionId);
}

type PositionPolicyInput = {
  action: string;
  allowed: boolean;
  scope: Scope;
  fields: string[] | null;
  constraints: string[] | null;
};

async function validatePolicyCeiling(
  ctx: RequestContext,
  policy: PositionPolicyInput,
): Promise<void> {
  if (!isAction(policy.action)) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_POLICY_INVALID_ACTION,
      `Unknown authorization action "${policy.action}"`,
    );
  }
  const definition = REGISTRY[policy.action];
  if (!isPositionPolicyGrantable(definition)) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_POLICY_NOT_GRANTABLE,
      `Action "${policy.action}" cannot be granted through a position policy`,
    );
  }
  const domain = definition.domain === 'derived' ? 'people' : definition.domain;
  if (!isScopeDefinedForDomain(policy.scope, domain)) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_POLICY_CEILING_EXCEEDED,
      `Scope "${policy.scope}" is invalid for ${domain}-domain action "${policy.action}"`,
    );
  }
  if (globalAccess(ctx.principal) || !policy.allowed) return;
  const ceiling = await effectivePolicy(ctx, policy.action);
  if (
    ceiling === null ||
    !ceiling.allowed ||
    !isWithinCeiling(policy.scope, ceiling.scope)
  ) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_POLICY_CEILING_EXCEEDED,
      `Policy for "${policy.action}" exceeds the creator's permission ceiling`,
      {
        action: policy.action,
        requestedScope: policy.scope,
        creatorScope: ceiling?.scope ?? null,
      },
    );
  }
  if (
    ceiling.fields !== undefined &&
    (policy.fields === null ||
      policy.fields.some((field) => !ceiling.fields?.includes(field)))
  ) {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.POSITION_POLICY_CEILING_EXCEEDED,
      `Policy fields for "${policy.action}" exceed the creator's permission ceiling`,
      {
        action: policy.action,
        requestedFields: policy.fields ?? null,
        creatorFields: ceiling.fields,
      },
    );
  }
}

export async function updatePositionPolicies(
  ctx: RequestContext,
  positionId: string,
  input: UpdatePositionPoliciesInput,
) {
  const policies = normalizePositionPolicies(input);
  for (const policy of policies) await validatePolicyCeiling(ctx, policy);

  return db.transaction(ctx, async (tx) => {
    const position = await findPosition(tx, ctx.organizationId, positionId);
    if (!position)
      throw new OrganizationNotFoundError(
        ORGANIZATION_ERROR_CODES.POSITION_NOT_FOUND,
        'Position not found',
      );
    const before = await listPositionPoliciesTx(tx, ctx.organizationId, positionId);
    const after = await replacePositionPolicies(
      tx,
      ctx.organizationId,
      positionId,
      policies,
    );
    const policyChanged = toPositionPolicyImpactPreview(
      position,
      before,
      policies,
      [],
    ).requiresConfirmation;
    if (policyChanged) {
      const holderIds = await directPositionHolderIds(tx, ctx.organizationId, positionId);
      await enqueuePermissionsChanged(tx, {
        organizationId: ctx.organizationId,
        positionId,
        holderIds,
        reason: 'position.policies.changed',
      });
    }
    await enqueueOrganizationAudit(tx, {
      ...auditContext(ctx),
      action: 'organization.position.policies.updated',
      resourceType: 'position',
      resourceId: positionId,
      before,
      after,
      stream: 'access',
      reason: 'Position access policy changed',
    });
    return after;
  });
}

/**
 * OR-7: validate the same candidate policy set as a save, then compare it with
 * the persisted set in a tenant-scoped read transaction. No audit or outbox
 * writer is invoked on this path.
 */
export async function previewPositionPolicies(
  ctx: RequestContext,
  positionId: string,
  input: UpdatePositionPoliciesInput,
) {
  const policies = normalizePositionPolicies(input);
  for (const policy of policies) await validatePolicyCeiling(ctx, policy);

  return db.transaction(ctx, async (tx) => {
    const position = await findPosition(tx, ctx.organizationId, positionId);
    if (!position)
      throw new OrganizationNotFoundError(
        ORGANIZATION_ERROR_CODES.POSITION_NOT_FOUND,
        'Position not found',
      );
    const [current, holderIds] = await Promise.all([
      listPositionPoliciesTx(tx, ctx.organizationId, positionId),
      directPositionHolderIds(tx, ctx.organizationId, positionId),
    ]);
    const scopeContext = await positionScopeDescriptionContext(tx, ctx, position);
    return {
      ...toPositionPolicyImpactPreview(position, current, policies, holderIds),
      scopeDescriptions: describePositionPolicyScopes(
        position,
        current,
        policies,
        scopeContext,
      ),
    };
  });
}

async function positionScopeDescriptionContext(
  tx: Tx,
  ctx: RequestContext,
  position: PositionRecord,
): Promise<PositionScopeDescriptionContext> {
  const [department, peoplePolicy] = await Promise.all([
    findDepartment(tx, ctx.organizationId, position.departmentId),
    effectivePolicy(ctx, 'org:view-people'),
  ]);
  const mayExposeCompleteCounts =
    globalAccess(ctx.principal) ||
    (peoplePolicy?.allowed === true && peoplePolicy.scope === 'all-people');
  if (!mayExposeCompleteCounts) {
    return {
      departmentName: department?.name ?? null,
      teamMemberCount: null,
      poolMemberCount: null,
      departmentMemberCount: null,
      organizationPeopleCount: null,
      multipleHolderContexts: false,
    };
  }

  const holders = await listActivePositionHolderPrincipals(
    tx,
    ctx.organizationId,
    position.id,
  );
  const holderContexts = holders.map((principal) => ({
    ...ctx,
    principal,
    memo: new Map<string, unknown>(),
  }));
  const [teamIds, poolMemberIds, departmentMemberCount, organizationPeopleCount] =
    await Promise.all([
      collectScopeIds(holderContexts, (holderCtx) => scopeResolver.teamIds(holderCtx)),
      collectScopeIds(holderContexts, (holderCtx) =>
        scopeResolver.poolMemberIds(holderCtx),
      ),
      countActiveEmployeesInDepartment(tx, ctx.organizationId, position.departmentId),
      countActiveEmployees(tx, ctx.organizationId),
    ]);

  return {
    departmentName: department?.name ?? null,
    teamMemberCount: await countActiveEmployeesInTeams(tx, ctx.organizationId, teamIds),
    poolMemberCount: poolMemberIds.length,
    departmentMemberCount,
    organizationPeopleCount,
    multipleHolderContexts: holders.length > 1,
  };
}

async function collectScopeIds(
  contexts: readonly RequestContext[],
  resolve: (ctx: RequestContext) => Promise<ReadonlySet<string>>,
): Promise<string[]> {
  const resolved = await Promise.all(contexts.map(resolve));
  return [...new Set(resolved.flatMap((ids) => [...ids]))].sort();
}

function normalizePositionPolicies(
  input: UpdatePositionPoliciesInput,
): PositionPolicyInput[] {
  return input.policies.map((policy) => ({
    ...policy,
    action: policy.action as Action,
    fields: policy.fields ?? null,
    constraints: policy.constraints ?? null,
  }));
}

export { loadPositionResource };
