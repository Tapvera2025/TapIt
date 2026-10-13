import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { createOpaqueToken, hashToken } from '../../platform/auth/crypto.js';
import {
  IdentityConflictError,
  IdentityNotFoundError,
  IdentityValidationError,
  hashIdentityPassword,
  sendEmployeeInvitation,
} from '../identity/facade.js';
import { clearOverridesForPositionChange } from '../access-management/facade.js';
import { repairReportingLinesAfterMove, validateManagerAssignment } from '../organization/facade.js';
import { changedDays } from './employment.js';
import { recordEmploymentChanged } from './events.js';
import {
  allocateEmployeeId,
  peekNextEmployeeId,
  syncOrganizationEmployeeIdCounter,
  createEmployee,
  emailExists,
  emailTakenByAnother,
  employeeIdExists,
  employeeIdTakenByAnother,
  enqueueEmployeeAudit,
  findDepartment,
  findDesignation,
  findEmployeeProfile,
  findPosition,
  findTeam,
  listInactiveEmployees,
  setAccountStatus,
  setEmployment,
  updatePlacement,
  updateProfile,
  saveEmployeeProfile,
  saveEmployeeQualifications,
  saveEmployeeSkills,
  createEmployeeSetupToken,
  type EmployeeProfile,
} from './repository.js';
import type {
  CreateEmployeeInput,
  EmployeeStatusInput,
  PlacementInput,
  UpdateEmployeeInput,
} from './validators.js';
import { notifyPlacementChanged } from './notifications.js';
import { assignTemplateShift } from '../shifts/facade.js';
import { createOnboardingWorkflow } from '../onboarding/facade.js';
import { localDateOf } from '../../platform/time.js';

export async function provisionEmployee(ctx: RequestContext, input: CreateEmployeeInput) {
  const email = input.email.trim().toLowerCase();
  const initialPassword = input.password || ('TempPass_' + createOpaqueToken(16));
  const passwordHash = await hashIdentityPassword(initialPassword);

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
      await syncOrganizationEmployeeIdCounter(tx, ctx.organizationId, employeeId);
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
    // Persist extended personal profile if provided
    if (input.personalInfo || input.phone) {
      await saveEmployeeProfile(tx, {
        organizationId: ctx.organizationId,
        userId: employee.id,
        phone: input.personalInfo?.phone ?? input.phone,
        dateOfBirth: input.personalInfo?.dateOfBirth,
        gender: input.personalInfo?.gender,
        addressLine1: input.personalInfo?.addressLine1,
        addressLine2: input.personalInfo?.addressLine2,
        city: input.personalInfo?.city,
        state: input.personalInfo?.state,
        postalCode: input.personalInfo?.postalCode,
        emergencyContactName: input.personalInfo?.emergencyContactName,
        emergencyContactPhone: input.personalInfo?.emergencyContactPhone,
        emergencyContactRelation: input.personalInfo?.emergencyContactRelation,
      });
    }

    // Persist qualifications if provided
    if (input.qualifications && input.qualifications.length > 0) {
      await saveEmployeeQualifications(
        tx,
        ctx.organizationId,
        employee.id,
        input.qualifications,
      );
    }

    // Persist skills if provided
    if (input.skills && input.skills.length > 0) {
      await saveEmployeeSkills(
        tx,
        ctx.organizationId,
        employee.id,
        input.skills,
      );
    }

    // Initial shift assignment if provided
    if (input.shiftId) {
      const effectiveDate = input.joiningDate ?? localDateOf(new Date(), 'UTC');
      await assignTemplateShift(tx, {
        organizationId: ctx.organizationId,
        userId: employee.id,
        shiftId: input.shiftId,
        effectiveFrom: effectiveDate,
        createdBy: ctx.principal.id,
      });
    }

    // Create Onboarding Workflow & seed PRD ON-1 checklist steps
    const onboardingStartDate = input.joiningDate ?? localDateOf(new Date(), 'UTC');
    const onboardingWf = await createOnboardingWorkflow(tx, {
      organizationId: ctx.organizationId,
      employeeId: employee.id,
      createdBy: ctx.principal.id,
      startDate: onboardingStartDate,
      managerId: input.reportsTo,
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
        onboardingWorkflowId: onboardingWf.id,
      },
    });
    // Generate Employee Account Setup Invitation Token
    const setupToken = createOpaqueToken(32);
    const setupTokenHash = hashToken(setupToken);
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000); // 72 hours

    await createEmployeeSetupToken(tx, {
      organizationId: ctx.organizationId,
      userId: employee.id,
      tokenHash: setupTokenHash,
      purpose: 'employee_password_setup',
      expiresAt,
      createdBy: ctx.principal.id,
    });

    const org = await tx.maybeOne<{ code: string }>(sql`
      SELECT code FROM organization WHERE id = ${ctx.organizationId}
    `);
    const organizationCode = org?.code ?? '';

    await enqueueEmployeeAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetId: employee.id,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'employee.setup_link_created',
      after: {
        employeeId: employee.employeeId,
        email: employee.email,
        purpose: 'employee_password_setup',
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      employee,
      onboardingWorkflowId: onboardingWf.id,
      setupToken,
      organizationCode,
      expiresAt,
    };
  });

  // Post-commit: deliver account setup link to employee email.
  // The employee chooses their permanent password via this link.
  let setupUrl: string | undefined;
  try {
    setupUrl = await sendEmployeeInvitation({
      email: result.employee.email,
      invitationToken: result.setupToken,
      organizationCode: result.organizationCode,
      expiresHours: 72,
      fullName: result.employee.fullName,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'employee invitation email delivery failed',
        employeeId: result.employee.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return {
    employee: result.employee,
    onboardingWorkflowId: result.onboardingWorkflowId,
    credentials: { delivery: 'email', status: 'sent' as const },
    ...(setupUrl ? { setupUrl } : {}),
  };
}

/** GET /api/users?status=inactive — deactivated employees within the caller's reach. */
export async function listDeactivatedEmployees(ctx: RequestContext) {
  const visibility = await visibilityFilter(ctx, 'users:view', 'user');
  return db.transaction(ctx, (tx) => listInactiveEmployees(tx, ctx.organizationId, visibility));
}

/** GET /api/users/:id — the profile the edit screen starts from. */
export async function getEmployee(ctx: RequestContext, userId: string): Promise<EmployeeProfile> {
  const profile = await db.transaction(ctx, (tx) => findEmployeeProfile(tx, ctx.organizationId, userId));
  if (profile === null) {
    throw new IdentityNotFoundError('IDENTITY_NOT_FOUND', 'Employee not found');
  }
  return profile;
}

/** Designation and specialization rules shared by create and edit. */
async function validateDesignation(
  tx: Tx,
  organizationId: string,
  designationId: string | null,
  specialization: string | null,
): Promise<void> {
  const designation = designationId ? await findDesignation(tx, organizationId, designationId) : null;
  if (designationId && !designation) {
    throw new IdentityValidationError('IDENTITY_DESIGNATION_INVALID', 'Designation does not belong to this organization');
  }
  if (designation !== null && designation.status !== 'active') {
    throw new IdentityValidationError('IDENTITY_DESIGNATION_INACTIVE', 'Designation is inactive');
  }
  if (specialization && !designation) {
    throw new IdentityValidationError('IDENTITY_SPECIALIZATION_INVALID', 'Specialization requires a designation');
  }
  if (
    specialization &&
    designation &&
    !designation.specializations.some(
      (value) => value.toLocaleLowerCase() === specialization.trim().toLocaleLowerCase(),
    )
  ) {
    throw new IdentityValidationError(
      'IDENTITY_SPECIALIZATION_INVALID',
      'Specialization is not configured for the designation',
    );
  }
}

/**
 * PATCH /api/users/:id — name, login email, employee ID, team, designation,
 * specialization and the employment window (both dates inclusive). Days
 * already recorded are re-judged by attendance after commit
 * (`employee.employment-changed`); nothing is deleted, and a day that falls
 * outside the new window is marked `not-employed` rather than removed (§8.6).
 * A team change re-checks the reporting lines it touches.
 */
export async function updateEmployee(
  ctx: RequestContext,
  userId: string,
  input: UpdateEmployeeInput,
) {
  return db.transaction(ctx, async (tx) => {
    const current = await findEmployeeProfile(tx, ctx.organizationId, userId, { forUpdate: true });
    if (current === null || current.accountType !== 'employee') {
      throw new IdentityValidationError(
        'IDENTITY_NOT_AN_EMPLOYEE',
        'Only an employee record can be edited here',
      );
    }

    const changes: Parameters<typeof updateProfile>[3] = {};
    if (input.fullName !== undefined && input.fullName !== current.fullName) changes.fullName = input.fullName;
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (email !== (current.email ?? '').toLowerCase()) {
        if (await emailTakenByAnother(tx, email, userId)) {
          throw new IdentityConflictError('IDENTITY_EMAIL_ALREADY_REGISTERED', 'Email is already registered');
        }
        changes.email = email;
      }
    }
    if (input.employeeId !== undefined && input.employeeId !== current.employeeId) {
      if (await employeeIdTakenByAnother(tx, ctx.organizationId, input.employeeId, userId)) {
        throw new IdentityConflictError('IDENTITY_EMPLOYEE_ID_ALREADY_USED', 'Employee ID is already in use');
      }
      changes.employeeId = input.employeeId;
    }
    if (input.teamId !== undefined && input.teamId !== current.teamId) {
      if (input.teamId !== null && !(await findTeam(tx, ctx.organizationId, input.teamId, current.departmentId!))) {
        throw new IdentityValidationError('IDENTITY_TEAM_INVALID', 'Team is invalid or belongs to another department');
      }
      changes.teamId = input.teamId;
    }
    const designationId = input.designationId === undefined ? current.designationId : input.designationId;
    const specialization = input.specialization === undefined
      ? (input.designationId === undefined ? current.specialization : null)
      : input.specialization?.trim() || null;
    if (input.designationId !== undefined || input.specialization !== undefined) {
      await validateDesignation(tx, ctx.organizationId, designationId, specialization);
      if (designationId !== current.designationId) changes.designationId = designationId;
      if (specialization !== current.specialization) changes.specialization = specialization;
    }

    const before = { joinedOn: current.joinedOn, leftOn: current.leftOn };
    const after = {
      joinedOn: input.joiningDate === undefined ? current.joinedOn : input.joiningDate,
      leftOn: input.leavingDate === undefined ? current.leftOn : input.leavingDate,
    };
    if (after.joinedOn !== null && after.leftOn !== null && after.leftOn < after.joinedOn) {
      throw new IdentityValidationError(
        'IDENTITY_EMPLOYMENT_DATES_INVALID',
        'The leaving date cannot come before the joining date',
      );
    }

    await updateProfile(tx, ctx.organizationId, userId, changes);
    const profileFields = Object.keys(changes) as (keyof typeof changes)[];
    if (profileFields.length > 0) {
      const pick = (source: Record<string, unknown>) =>
        Object.fromEntries(profileFields.map((field) => [field, source[field] ?? null]));
      await enqueueEmployeeAudit(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.principal.id,
        actorType: ctx.principal.accountType,
        targetId: userId,
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
        action: 'employee.profile_updated',
        before: pick(current as unknown as Record<string, unknown>),
        after: pick(changes),
      });
    }
    const clearedLines = changes.teamId !== undefined
      ? await repairReportingLinesAfterMove(tx, ctx.organizationId, userId)
      : [];

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
    const profile = (await findEmployeeProfile(tx, ctx.organizationId, userId))!;
    return {
      ...profile,
      // Kept for existing callers of the dates-only endpoint.
      joiningDate: profile.joinedOn,
      leavingDate: profile.leftOn,
      reportingLinesCleared: clearedLines,
    };
  });
}

/**
 * POST /api/users/:id/placement — Super Admin changes department, position,
 * team and manager in one step (HR uses a role-change request instead).
 * Reporting lines the move breaks are cleared, position-relative overrides end,
 * and the person's sessions restart with the new position's powers.
 */
export async function changePlacement(
  ctx: RequestContext,
  userId: string,
  input: PlacementInput,
) {
  return db.transaction(ctx, async (tx) => {
    const current = await findEmployeeProfile(tx, ctx.organizationId, userId, { forUpdate: true });
    if (current === null || current.accountType !== 'employee') {
      throw new IdentityValidationError('IDENTITY_NOT_AN_EMPLOYEE', 'Only an employee can be placed in a position');
    }
    if (!(await findDepartment(tx, ctx.organizationId, input.departmentId))) {
      throw new IdentityValidationError('IDENTITY_DEPARTMENT_INVALID', 'Department is invalid or inactive');
    }
    if (!(await findPosition(tx, ctx.organizationId, input.positionId, input.departmentId))) {
      throw new IdentityValidationError(
        'IDENTITY_POSITION_INVALID',
        'Position is invalid, inactive, or belongs to another department',
      );
    }
    // A team belongs to one department: moving department drops a team that doesn't follow.
    const teamId = input.teamId !== undefined
      ? input.teamId
      : input.departmentId === current.departmentId ? current.teamId : null;
    if (teamId !== null && !(await findTeam(tx, ctx.organizationId, teamId, input.departmentId))) {
      throw new IdentityValidationError('IDENTITY_TEAM_INVALID', 'Team is invalid or belongs to another department');
    }
    if (input.reportsTo !== undefined && input.reportsTo !== null) {
      await validateManagerAssignment(tx, {
        organizationId: ctx.organizationId,
        subjectUserId: userId,
        subjectDepartmentId: input.departmentId,
        subjectPositionId: input.positionId,
        subjectTeamId: teamId,
        managerUserId: input.reportsTo,
      });
    }
    const positionChanged = input.positionId !== current.positionId;
    await updatePlacement(tx, ctx.organizationId, userId, {
      departmentId: input.departmentId,
      positionId: input.positionId,
      teamId,
      ...(input.reportsTo === undefined ? {} : { reportsTo: input.reportsTo }),
    });
    const clearedLines = await repairReportingLinesAfterMove(tx, ctx.organizationId, userId);
    const overridesCleared = positionChanged ? await clearOverridesForPositionChange(tx, ctx, userId) : 0;
    await enqueueEmployeeAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetId: userId,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: 'employee.placement_changed',
      before: {
        departmentId: current.departmentId,
        positionId: current.positionId,
        teamId: current.teamId,
        reportsTo: current.reportsTo,
      },
      after: {
        departmentId: input.departmentId,
        positionId: input.positionId,
        teamId,
        reportsTo: input.reportsTo === undefined ? current.reportsTo : input.reportsTo,
        reportingLinesCleared: clearedLines,
        overridesCleared,
        reason: input.reason ?? null,
      },
    });
    const profile = (await findEmployeeProfile(tx, ctx.organizationId, userId))!;
    await notifyPlacementChanged(tx, ctx, userId, current, profile);
    return { ...profile, reportingLinesCleared: clearedLines, overridesCleared };
  });
}

/**
 * POST /api/users/:id/status — deactivate a login (sessions end at once) or
 * reactivate it. Employment dates are separate: set a leaving date to stop
 * attendance and pay on the right day.
 */
export async function setEmployeeStatus(
  ctx: RequestContext,
  userId: string,
  input: EmployeeStatusInput,
) {
  if (userId === ctx.principal.id) {
    throw new IdentityValidationError('IDENTITY_STATUS_SELF', 'You cannot change the status of your own account');
  }
  return db.transaction(ctx, async (tx) => {
    const current = await findEmployeeProfile(tx, ctx.organizationId, userId, { forUpdate: true });
    if (current === null || current.accountType !== 'employee') {
      throw new IdentityValidationError('IDENTITY_NOT_AN_EMPLOYEE', 'Only an employee account can be deactivated here');
    }
    if (current.status === 'offboarded') {
      throw new IdentityValidationError('IDENTITY_STATUS_FINAL', 'An offboarded account cannot be changed');
    }
    const next = input.status;
    if ((current.status === 'active' || current.status === 'locked') && next === 'active') {
      return { ...current, status: current.status };
    }
    if (current.status === 'inactive' && next === 'inactive') return current;
    await setAccountStatus(tx, ctx.organizationId, userId, next);
    await enqueueEmployeeAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetId: userId,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      action: next === 'inactive' ? 'employee.deactivated' : 'employee.reactivated',
      before: { status: current.status },
      after: { status: next, reason: input.reason },
    });
    return (await findEmployeeProfile(tx, ctx.organizationId, userId))!;
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

export async function getNextEmployeeId(ctx: RequestContext, currentCandidate?: string): Promise<string> {
  return db.transaction(ctx, (tx) => peekNextEmployeeId(tx, ctx.organizationId, currentCandidate));
}
