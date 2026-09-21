import { MATCH_ALL, effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { enqueueOrganizationAudit } from '../repository.js';
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  ORGANIZATION_ERROR_CODES,
} from '../errors.js';
import type { CreateDepartmentInput, UpdateDepartmentInput } from '../validators.js';
import {
  findDepartment,
  findDepartmentByCode,
  insertDepartment,
  listDepartments as listRows,
  loadDepartmentResource,
  updateDepartment as updateRow,
  type DepartmentRecord,
} from './repository.js';

export async function listDepartments(ctx: RequestContext): Promise<DepartmentRecord[]> {
  const policy = await effectivePolicy(ctx, 'org:view-structure');
  // OR-13: a department-scoped organization viewer may route to every branch,
  // but only people endpoints disclose who works there.
  const filter =
    policy?.allowed === true && policy.scope === 'department'
      ? MATCH_ALL
      : await visibilityFilter(ctx, 'org:view-structure', 'department');
  return listRows(ctx, filter);
}

export async function createDepartment(
  ctx: RequestContext,
  input: CreateDepartmentInput,
): Promise<DepartmentRecord> {
  return db.transaction(ctx, async (tx) => {
    if (await findDepartmentByCode(tx, ctx.organizationId, input.code))
      throw new OrganizationConflictError(
        ORGANIZATION_ERROR_CODES.DEPARTMENT_CODE_EXISTS,
        `Department code "${input.code}" already exists`,
      );
    const department = await insertDepartment(tx, {
      organizationId: ctx.organizationId,
      ...input,
    });
    await enqueueOrganizationAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'organization.department.created',
      resourceType: 'department',
      resourceId: department.id,
      before: null,
      after: department,
    });
    return department;
  });
}

export async function updateDepartment(
  ctx: RequestContext,
  id: string,
  input: UpdateDepartmentInput,
): Promise<DepartmentRecord> {
  return db.transaction(ctx, async (tx) => {
    const before = await findDepartment(tx, ctx.organizationId, id);
    if (!before)
      throw new OrganizationNotFoundError(
        ORGANIZATION_ERROR_CODES.DEPARTMENT_NOT_FOUND,
        'Department not found',
      );
    const after = await updateRow(tx, {
      organizationId: ctx.organizationId,
      id,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    await enqueueOrganizationAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'organization.department.updated',
      resourceType: 'department',
      resourceId: id,
      before,
      after,
    });
    return after;
  });
}

export { loadDepartmentResource };
