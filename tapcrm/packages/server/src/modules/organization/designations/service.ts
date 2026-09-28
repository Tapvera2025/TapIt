import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { enqueueOrganizationAudit } from '../repository.js';
import { findDepartment } from '../departments/repository.js';
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
  ORGANIZATION_ERROR_CODES,
} from '../errors.js';
import type { CreateDesignationInput, UpdateDesignationInput } from '../validators.js';
import {
  findDesignation,
  findDesignationByName,
  insertDesignation,
  listDesignations as listRows,
  loadDesignationResource,
  updateDesignation,
  type DesignationRecord,
} from './repository.js';

async function assertActiveDepartment(
  tx: Tx,
  organizationId: string,
  departmentId: string,
): Promise<void> {
  const department = await findDepartment(tx, organizationId, departmentId);
  if (!department || department.status !== 'active') {
    throw new OrganizationValidationError(
      ORGANIZATION_ERROR_CODES.DESIGNATION_DEPARTMENT_INVALID,
      'Department is invalid or inactive',
    );
  }
}

export function normalizeSpecializations(values: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new OrganizationConflictError(
        ORGANIZATION_ERROR_CODES.DESIGNATION_SPECIALIZATION_DUPLICATE,
        `Specialization "${trimmed}" is duplicated under the designation`,
      );
    }
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

export async function listDesignations(
  ctx: RequestContext,
): Promise<DesignationRecord[]> {
  return listRows(
    ctx,
    await visibilityFilter(ctx, 'org:view-designations', 'designation'),
  );
}

export async function createDesignation(
  ctx: RequestContext,
  input: CreateDesignationInput,
): Promise<DesignationRecord> {
  return db.transaction(ctx, async (tx) => {
    await assertActiveDepartment(tx, ctx.organizationId, input.departmentId);
    if (await findDesignationByName(tx, ctx.organizationId, input.name))
      throw new OrganizationConflictError(
        ORGANIZATION_ERROR_CODES.DESIGNATION_NAME_EXISTS,
        `Designation name "${input.name}" already exists`,
      );
    const designation = await insertDesignation(tx, {
      organizationId: ctx.organizationId,
      departmentId: input.departmentId,
      name: input.name,
      specializations: normalizeSpecializations(input.specializations),
    });
    await enqueueOrganizationAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'organization.designation.created',
      resourceType: 'designation',
      resourceId: designation.id,
      before: null,
      after: designation,
    });
    return designation;
  });
}

export async function updateDesignationById(
  ctx: RequestContext,
  id: string,
  input: UpdateDesignationInput,
): Promise<DesignationRecord> {
  return db.transaction(ctx, async (tx) => {
    const before = await findDesignation(tx, ctx.organizationId, id);
    if (!before) {
      throw new OrganizationNotFoundError(
        ORGANIZATION_ERROR_CODES.DESIGNATION_NOT_FOUND,
        'Designation not found',
      );
    }
    const next = {
      departmentId: input.departmentId ?? before.departmentId,
      name: input.name ?? before.name,
      specializations:
        input.specializations === undefined
          ? before.specializations
          : normalizeSpecializations(input.specializations),
      status: input.status ?? before.status,
    };
    if (input.departmentId !== undefined && input.departmentId !== before.departmentId) {
      await assertActiveDepartment(tx, ctx.organizationId, input.departmentId);
    }
    if (await findDesignationByName(tx, ctx.organizationId, next.name, id)) {
      throw new OrganizationConflictError(
        ORGANIZATION_ERROR_CODES.DESIGNATION_NAME_EXISTS,
        `Designation name "${next.name}" already exists`,
      );
    }
    const after = await updateDesignation(tx, {
      organizationId: ctx.organizationId,
      id,
      ...next,
    });
    await enqueueOrganizationAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'organization.designation.updated',
      resourceType: 'designation',
      resourceId: id,
      before,
      after,
    });
    return after;
  });
}

export { loadDesignationResource };
