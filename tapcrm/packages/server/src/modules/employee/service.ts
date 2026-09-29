import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  IdentityConflictError,
  IdentityValidationError,
  hashIdentityPassword,
  sendEmployeeCredentials,
} from '../identity/facade.js';
import { validateManagerAssignment } from '../organization/facade.js';
import { changedDays } from './employment.js';
import { recordEmploymentChanged } from './events.js';
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
  lockEmployment,
  setEmployment,
} from './repository.js';
import type { CreateEmployeeInput, UpdateEmployeeInput } from './validators.js';

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
      joinedOn: input.joiningDate ?? null,
    });
    await enqueueEmployeeAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetId: employee.id,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      after: {
        employeeId: employee.employeeId,
        email: employee.email,
        fullName: employee.fullName,
        status: employee.status,
      },
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

/**
 * PATCH /api/users/:id — for now, the employment window: the joining and the
 * leaving date, both inclusive. Days already recorded are re-judged by
 * attendance after commit (`employee.employment-changed`); nothing is
 * deleted, and a day that falls outside the new window is marked
 * `not-employed` rather than removed (§8.6).
 */
export async function updateEmployee(
  ctx: RequestContext,
  userId: string,
  input: UpdateEmployeeInput,
) {
  return db.transaction(ctx, async (tx) => {
    const current = await lockEmployment(tx, userId);
    if (current === null || current.accountType !== 'employee') {
      throw new IdentityValidationError(
        'IDENTITY_NOT_AN_EMPLOYEE',
        'Only an employee has joining and leaving dates',
      );
    }
    const before = { joinedOn: current.joinedOn, leftOn: current.leftOn };
    const after = {
      joinedOn: input.joiningDate === undefined ? current.joinedOn : input.joiningDate,
      leftOn: input.leavingDate === undefined ? current.leftOn : input.leavingDate,
    };
    if (
      after.joinedOn !== null &&
      after.leftOn !== null &&
      after.leftOn < after.joinedOn
    ) {
      throw new IdentityValidationError(
        'IDENTITY_EMPLOYMENT_DATES_INVALID',
        'The leaving date cannot come before the joining date',
      );
    }
    const changed = changedDays(before, after);
    if (changed !== null) {
      await setEmployment(tx, userId, after);
      await enqueueEmployeeAudit(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.principal.id,
        actorType: ctx.principal.accountType,
        targetId: userId,
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
        action: 'employee.employment_dates_changed',
        before: { joiningDate: before.joinedOn, leavingDate: before.leftOn },
        after: { joiningDate: after.joinedOn, leavingDate: after.leftOn },
      });
      await recordEmploymentChanged(tx, ctx.organizationId, { userId, ...changed });
    }
    return { id: userId, joiningDate: after.joinedOn, leavingDate: after.leftOn };
  });
}

export async function adminResetPassword(
  ctx: RequestContext,
  userId: string,
  password: string,
): Promise<{ ok: true }> {
  const passwordHash = await hashIdentityPassword(password);
  return db.transaction(ctx, async (tx) => {
    const user = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM app_user
      WHERE id = ${userId}::uuid AND organization_id = ${ctx.organizationId}
        AND account_type = 'employee' AND status = 'active'
    `);
    if (!user) {
      throw new IdentityValidationError('IDENTITY_NOT_FOUND', 'Employee not found or inactive');
    }
    await tx.query(sql`
      UPDATE app_user
      SET password_hash = ${passwordHash},
          must_change_password = true,
          session_version = session_version + 1
      WHERE id = ${userId}::uuid AND organization_id = ${ctx.organizationId}
    `);
    await tx.query(sql`
      UPDATE session SET revoked_at = now()
      WHERE organization_id = ${ctx.organizationId}
        AND user_id = ${userId}::uuid
        AND revoked_at IS NULL
    `);
    await enqueueEmployeeAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetId: userId,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'employee.password_reset_by_admin',
      before: {},
      after: { mustChangePassword: true },
    });
    return { ok: true as const };
  });
}
