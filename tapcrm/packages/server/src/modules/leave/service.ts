import type { LeaveTypeDto } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { LEAVE_ERROR_CODES, LeaveTypeNotFoundError, LeaveValidationError } from './errors.js';
import * as repo from './repository.js';
import type { CreateLeaveTypeBody, UpdateLeaveTypeBody } from './validators.js';

export function toLeaveTypeDto(row: repo.LeaveTypeRow): LeaveTypeDto {
  return {
    id: row.id, code: row.code, name: row.name, kind: row.kind,
    accrualDays: row.accrualDays, enforcement: row.enforcement,
    paidLeave: row.paidLeave, isActive: row.isActive,
  };
}

export async function listLeaveTypes(ctx: RequestContext): Promise<LeaveTypeDto[]> {
  return db.transaction(ctx, async (tx) => (await repo.listLeaveTypes(tx)).map(toLeaveTypeDto));
}

export async function createLeaveType(ctx: RequestContext, body: CreateLeaveTypeBody): Promise<LeaveTypeDto> {
  if (body.enforcement)
    throw new LeaveValidationError(LEAVE_ERROR_CODES.ENFORCEMENT_NOT_ENABLED,
      'Enforcement cannot be enabled until opening balances are seeded (leave go-live task).');
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);
    return toLeaveTypeDto(await repo.insertLeaveType(tx, orgId, body, ctx.principal.id));
  });
}

export async function updateLeaveType(ctx: RequestContext, id: string, body: UpdateLeaveTypeBody): Promise<LeaveTypeDto> {
  if (body.enforcement === true)
    throw new LeaveValidationError(LEAVE_ERROR_CODES.ENFORCEMENT_NOT_ENABLED,
      'Enforcement cannot be enabled until opening balances are seeded (leave go-live task).');
  return db.transaction(ctx, async (tx) => {
    if (!(await repo.findLeaveTypeById(tx, id))) throw new LeaveTypeNotFoundError();
    const patch: Parameters<typeof repo.updateLeaveType>[2] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.accrualDays !== undefined) patch.accrualDays = body.accrualDays;
    if (body.enforcement !== undefined) patch.enforcement = body.enforcement;
    if (body.paidLeave !== undefined) patch.paidLeave = body.paidLeave;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    return toLeaveTypeDto(await repo.updateLeaveType(tx, id, patch));
  });
}
