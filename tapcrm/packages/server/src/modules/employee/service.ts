import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { IdentityConflictError, IdentityValidationError } from '../identity/errors.js';
import { hashIdentityPassword } from '../identity/password/service.js';
import { sendEmployeeCredentials } from '../identity/notifications/invitation-email.js';
import { validateManagerAssignment } from '../organization/reporting/service.js';
import {
  allocateEmployeeId,
  createEmployee,
  emailExists,
  employeeIdExists,
  enqueueEmployeeAudit,
  findDepartment,
  findDesignation,
  findPosition,
  findTeam,
} from './repository.js';
import type { CreateEmployeeInput } from './validators.js';

export async function provisionEmployee(ctx: RequestContext, input: CreateEmployeeInput) {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashIdentityPassword(input.password);

  const result = await db.transaction(ctx, async (tx) => {
    if (await emailExists(tx, email)) {
      throw new IdentityConflictError(
        'IDENTITY_EMAIL_ALREADY_REGISTERED',
        'Email is already registered',
      );
    }
    if (!(await findDepartment(tx, ctx.organizationId, input.departmentId))) {
      throw new IdentityValidationError(
        'IDENTITY_DEPARTMENT_INVALID',
        'Department is invalid or inactive',
      );
    }
    if (
      !(await findPosition(tx, ctx.organizationId, input.positionId, input.departmentId))
    ) {
      throw new IdentityValidationError(
        'IDENTITY_POSITION_INVALID',
        'Position is invalid, inactive, or belongs to another department',
      );
    }
    if (
      input.teamId &&
      !(await findTeam(tx, ctx.organizationId, input.teamId, input.departmentId))
    ) {
      throw new IdentityValidationError(
        'IDENTITY_TEAM_INVALID',
        'Team is invalid or belongs to another department',
      );
    }
    const designation = input.designationId
      ? await findDesignation(tx, ctx.organizationId, input.designationId)
      : null;
    if (input.designationId && !designation) {
      throw new IdentityValidationError(
        'IDENTITY_DESIGNATION_INVALID',
        'Designation does not belong to this organization',
      );
    }
    if (designation !== null && designation.status !== 'active') {
      throw new IdentityValidationError(
        'IDENTITY_DESIGNATION_INACTIVE',
        'Designation is inactive',
      );
    }
    if (input.specialization && !designation) {
      throw new IdentityValidationError(
        'IDENTITY_SPECIALIZATION_INVALID',
        'Specialization requires a designation',
      );
    }
    if (
      input.specialization &&
      designation &&
      !designation.specializations.some(
        (value) =>
          value.toLocaleLowerCase() === input.specialization!.trim().toLocaleLowerCase(),
      )
    ) {
      throw new IdentityValidationError(
        'IDENTITY_SPECIALIZATION_INVALID',
        'Specialization is not configured for the designation',
      );
    }
    if (input.reportsTo) {
      await validateManagerAssignment(tx, {
        organizationId: ctx.organizationId,
        subjectUserId: null,
        subjectDepartmentId: input.departmentId,
        subjectPositionId: input.positionId,
        managerUserId: input.reportsTo,
      });
    }

    // ED-3 — allocate or accept the caller's override. A caller supplying an
    // ID (typically an HR migration from a legacy HRMS) still gets uniqueness
    // checked at the app layer so we return 409 instead of a raw constraint
    // violation.
    let employeeId: string;
    if (input.employeeId !== undefined) {
      if (await employeeIdExists(tx, ctx.organizationId, input.employeeId)) {
        throw new IdentityConflictError(
          'IDENTITY_EMPLOYEE_ID_ALREADY_USED',
          'Employee ID is already in use',
        );
      }
      employeeId = input.employeeId;
    } else {
      employeeId = await allocateEmployeeId(tx, ctx.organizationId);
    }

    const employee = await createEmployee(tx, {
      organizationId: ctx.organizationId,
      employeeId,
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
    initialPassword: input.password,
  });

  return {
    employee: result,
    credentials: { delivery: 'email', status: 'sent' as const },
  };
}
