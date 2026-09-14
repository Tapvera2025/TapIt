import { randomInt } from 'node:crypto';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { IdentityConflictError, IdentityValidationError } from '../identity/errors.js';
import { hashIdentityPassword } from '../identity/password/service.js';
import { sendEmployeeCredentials } from '../identity/notifications/invitation-email.js';
import {
  createEmployee,
  emailExists,
  enqueueEmployeeAudit,
  findDepartment,
  findDesignation,
  findManager,
  findPosition,
  findTeam,
} from './repository.js';
import type { CreateEmployeeInput } from './validators.js';

const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

function generateTemporaryPassword(length = 24): string {
  return Array.from({ length }, () => TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)]).join('');
}

export async function provisionEmployee(ctx: RequestContext, input: CreateEmployeeInput) {
  const email = input.email.trim().toLowerCase();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashIdentityPassword(temporaryPassword);

  const result = await db.transaction(ctx, async (tx) => {
    if (await emailExists(tx, email)) {
      throw new IdentityConflictError('IDENTITY_EMAIL_ALREADY_REGISTERED', 'Email is already registered');
    }
    if (!await findDepartment(tx, ctx.organizationId, input.departmentId)) {
      throw new IdentityValidationError('IDENTITY_DEPARTMENT_INVALID', 'Department is invalid or inactive');
    }
    if (!await findPosition(tx, ctx.organizationId, input.positionId, input.departmentId)) {
      throw new IdentityValidationError('IDENTITY_POSITION_INVALID', 'Position is invalid, inactive, or belongs to another department');
    }
    if (input.teamId && !await findTeam(tx, ctx.organizationId, input.teamId, input.departmentId)) {
      throw new IdentityValidationError('IDENTITY_TEAM_INVALID', 'Team is invalid or belongs to another department');
    }
    if (input.designationId && !await findDesignation(tx, ctx.organizationId, input.designationId)) {
      throw new IdentityValidationError('IDENTITY_DESIGNATION_INVALID', 'Designation does not belong to this organization');
    }
    if (input.reportsTo && !await findManager(tx, ctx.organizationId, input.reportsTo, input.departmentId)) {
      throw new IdentityValidationError('IDENTITY_MANAGER_INVALID', 'Reports-to employee is invalid or belongs to another department');
    }

    const employee = await createEmployee(tx, {
      organizationId: ctx.organizationId,
      email,
      fullName: input.fullName.trim(),
      passwordHash,
      departmentId: input.departmentId,
      positionId: input.positionId,
      teamId: input.teamId ?? null,
      designationId: input.designationId ?? null,
      specialization: input.specialization?.trim() || null,
      reportsTo: input.reportsTo ?? null,
    });
    await enqueueEmployeeAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetId: employee.id,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    });
    return employee;
  });

  // The current mailer is synchronous, so delivery happens after commit. The
  // password remains in memory only for this notification call and is never
  // included in the API response or audit payload.
  await sendEmployeeCredentials({
    to: result.email,
    fullName: result.fullName,
    temporaryPassword,
  });

  return {
    employee: result,
    credentials: { delivery: 'email', status: 'sent' as const },
  };
}
