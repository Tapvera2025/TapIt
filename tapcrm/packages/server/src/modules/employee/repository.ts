import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export async function emailExists(tx: Tx, email: string): Promise<boolean> {
  const row = await tx.maybeOne<{ email: string }>(sql`
    SELECT email FROM identity_email_directory WHERE email = ${email}
  `);
  return row !== null;
}

export async function findDepartment(tx: Tx, organizationId: string, id: string) {
  return tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM department
    WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'active'
  `);
}

export async function findPosition(
  tx: Tx,
  organizationId: string,
  id: string,
  departmentId: string,
) {
  return tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM position
    WHERE organization_id = ${organizationId} AND id = ${id}
      AND department_id = ${departmentId} AND status = 'active'
  `);
}

export async function findTeam(
  tx: Tx,
  organizationId: string,
  id: string,
  departmentId: string,
) {
  return tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM team
    WHERE organization_id = ${organizationId} AND id = ${id} AND department_id = ${departmentId}
  `);
}

export async function findDesignation(tx: Tx, organizationId: string, id: string) {
  return tx.maybeOne<{
    id: string;
    status: 'active' | 'inactive';
    specializations: string[];
  }>(sql`
    SELECT id, status, specializations FROM designation
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function findManager(
  tx: Tx,
  organizationId: string,
  id: string,
  departmentId: string,
) {
  return tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId} AND id = ${id}
      AND status = 'active'
      AND (account_type = 'super-admin' OR (account_type = 'employee' AND department_id = ${departmentId}))
  `);
}

export async function employeeIdExists(
  tx: Tx,
  organizationId: string,
  employeeId: string,
): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND employee_id = ${employeeId}
  `);
  return row !== null;
}

/**
 * ED-3 — Allocate the next auto-generated employee ID for the organization.
 *
 * Locks the organization row FOR UPDATE, reads the current counter, formats
 * the ID as `<prefix>-<5-digit zero-padded number>`, and advances the counter.
 * The lock serialises concurrent allocations on the same organization; gaps
 * from rolled-back allocations are acceptable (this is not statutory
 * numbering).
 *
 * The format widens naturally when the counter passes 99999 — lpad only pads,
 * so `EMP-100000` is emitted as-is.
 */
export async function allocateEmployeeId(
  tx: Tx,
  organizationId: string,
): Promise<string> {
  const row = await tx.one<{ prefix: string; nextNumber: string }>(sql`
    SELECT employee_id_prefix AS prefix,
           employee_id_next_number::text AS next_number
    FROM organization
    WHERE id = ${organizationId}
    FOR UPDATE
  `);
  const nextNumber = BigInt(row.nextNumber);
  const formatted = `${row.prefix}-${nextNumber.toString().padStart(5, '0')}`;
  await tx.query(sql`
    UPDATE organization
    SET employee_id_next_number = ${(nextNumber + 1n).toString()}::bigint
    WHERE id = ${organizationId}
  `);
  return formatted;
}

export async function createEmployee(
  tx: Tx,
  input: {
    organizationId: string;
    employeeId: string;
    email: string;
    fullName: string;
    passwordHash: string;
    departmentId: string;
    positionId: string;
    teamId: string | null;
    designationId: string | null;
    specialization: string | null;
    reportsTo: string | null;
    joinedOn: DateOnly | null;
  },
) {
  return tx.one<{
    id: string;
    employeeId: string;
    email: string;
    fullName: string;
    accountType: 'employee';
    status: string;
  }>(sql`
    INSERT INTO app_user(
      organization_id, account_type, employee_id, email, password_hash, status, email_verified_at,
      department_id, position_id, team_id, designation_id, specialization,
      reports_to, full_name, must_change_password, joined_on
    )
    VALUES (
      ${input.organizationId}, 'employee', ${input.employeeId}, ${input.email}, ${input.passwordHash}, 'active', now(),
      ${input.departmentId}, ${input.positionId}, ${input.teamId}, ${input.designationId},
      ${input.specialization}, ${input.reportsTo}, ${input.fullName}, true, ${input.joinedOn}
    )
    RETURNING id, employee_id, email, full_name, account_type, status
  `);
}

export async function enqueueEmployeeAudit(
  tx: Tx,
  input: {
    organizationId: string;
    actorId: string;
    actorType: string;
    targetId: string;
    requestId: string;
    sourceIp: string | null;
    after: unknown;
    /** Defaults to a creation: no `before`. */
    action?: string;
    before?: unknown;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox(organization_id, stream, payload)
    VALUES (
      ${input.organizationId}, 'activity',
      ${JSON.stringify({
        action: input.action ?? 'employee.created',
        actorId: input.actorId,
        actorType: input.actorType,
        targetType: 'user',
        targetId: input.targetId,
        before: input.before ?? null,
        after: input.after,
        reason: null,
        requestId: input.requestId,
        sourceIp: input.sourceIp,
      })}::jsonb
    )
  `);
}

export interface EmployeeProfile {
  id: string;
  accountType: string;
  status: string;
  fullName: string;
  email: string | null;
  employeeId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionName: string | null;
  teamId: string | null;
  teamName: string | null;
  designationId: string | null;
  designationName: string | null;
  specialization: string | null;
  reportsTo: string | null;
  reportsToName: string | null;
  joinedOn: DateOnly | null;
  leftOn: DateOnly | null;
  mustChangePassword: boolean;
  createdAt: string;
}

/** One person's editable profile, with the names the edit screen shows. */
export async function findEmployeeProfile(
  tx: Tx,
  organizationId: string,
  userId: string,
  options: { forUpdate?: boolean } = {},
): Promise<EmployeeProfile | null> {
  return tx.maybeOne<EmployeeProfile>(sql`
    SELECT u.id, u.account_type, u.status, u.full_name, u.email::text AS email, u.employee_id,
           u.department_id, d.name AS department_name,
           u.position_id, p.name AS position_name,
           u.team_id, t.name AS team_name,
           u.designation_id, des.name AS designation_name,
           u.specialization, u.reports_to, m.full_name AS reports_to_name,
           u.joined_on::text AS joined_on, u.left_on::text AS left_on,
           u.must_change_password, u.created_at::text AS created_at
    FROM app_user u
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    LEFT JOIN designation des ON des.organization_id = u.organization_id AND des.id = u.designation_id
    LEFT JOIN app_user m ON m.organization_id = u.organization_id AND m.id = u.reports_to
    WHERE u.organization_id = ${organizationId} AND u.id = ${userId}::uuid
    ${options.forUpdate ? sql`FOR UPDATE OF u` : sql``}
  `);
}

export async function emailTakenByAnother(tx: Tx, email: string, userId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ userId: string }>(sql`
    SELECT user_id FROM identity_email_directory WHERE email = ${email}
  `);
  return row !== null && row.userId !== userId;
}

export async function employeeIdTakenByAnother(
  tx: Tx,
  organizationId: string,
  employeeId: string,
  userId: string,
): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND employee_id = ${employeeId}
      AND id <> ${userId}::uuid
  `);
  return row !== null;
}

/** Write the profile columns that changed. */
export async function updateProfile(
  tx: Tx,
  organizationId: string,
  userId: string,
  changes: {
    fullName?: string;
    email?: string;
    employeeId?: string;
    teamId?: string | null;
    designationId?: string | null;
    specialization?: string | null;
  },
): Promise<void> {
  const sets = [
    changes.fullName !== undefined ? sql`full_name = ${changes.fullName}` : null,
    changes.email !== undefined ? sql`email = ${changes.email}` : null,
    changes.employeeId !== undefined ? sql`employee_id = ${changes.employeeId}` : null,
    changes.teamId !== undefined ? sql`team_id = ${changes.teamId}::uuid` : null,
    changes.designationId !== undefined ? sql`designation_id = ${changes.designationId}::uuid` : null,
    changes.specialization !== undefined ? sql`specialization = ${changes.specialization}` : null,
  ].filter((fragment): fragment is NonNullable<typeof fragment> => fragment !== null);
  if (sets.length === 0) return;
  await tx.query(sql`
    UPDATE app_user SET ${sql.join(sets, ', ')}, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${userId}::uuid
  `);
}

/** Move someone: department, position, team and (optionally) manager. Sessions restart with the new powers. */
export async function updatePlacement(
  tx: Tx,
  organizationId: string,
  userId: string,
  placement: {
    departmentId: string;
    positionId: string;
    teamId: string | null;
    reportsTo?: string | null;
  },
): Promise<void> {
  await tx.query(sql`
    UPDATE app_user
    SET department_id = ${placement.departmentId}::uuid,
        position_id = ${placement.positionId}::uuid,
        team_id = ${placement.teamId}::uuid,
        ${placement.reportsTo === undefined ? sql`reports_to = reports_to` : sql`reports_to = ${placement.reportsTo}::uuid`},
        session_version = session_version + 1,
        updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${userId}::uuid
  `);
}

export async function setAccountStatus(
  tx: Tx,
  organizationId: string,
  userId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await tx.query(sql`
    UPDATE app_user
    SET status = ${status},
        session_version = session_version + 1,
        updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${userId}::uuid
  `);
  if (status === 'inactive') {
    await tx.query(sql`
      UPDATE session SET revoked_at = now()
      WHERE organization_id = ${organizationId} AND user_id = ${userId}::uuid AND revoked_at IS NULL
    `);
  }
}

export interface EmploymentRow {
  id: string;
  accountType: string;
  joinedOn: DateOnly | null;
  leftOn: DateOnly | null;
}

/** The person's employment window, locked for the change. */
export async function lockEmployment(
  tx: Tx,
  userId: string,
): Promise<EmploymentRow | null> {
  return tx.maybeOne<EmploymentRow>(sql`
    SELECT id, account_type, joined_on::text AS joined_on, left_on::text AS left_on
    FROM app_user WHERE id = ${userId}
    FOR UPDATE
  `);
}

export async function setEmployment(
  tx: Tx,
  userId: string,
  window: { joinedOn: DateOnly | null; leftOn: DateOnly | null },
): Promise<void> {
  await tx.query(sql`
    UPDATE app_user SET joined_on = ${window.joinedOn}, left_on = ${window.leftOn}
    WHERE id = ${userId}
  `);
}

export interface InactiveEmployeeRow {
  id: string;
  fullName: string;
  email: string | null;
  employeeId: string | null;
  status: string;
  departmentName: string | null;
  positionName: string | null;
  leftOn: DateOnly | null;
}

/** Deactivated employees the caller may see, so they can be reviewed or reactivated. */
export async function listInactiveEmployees(
  tx: Tx,
  organizationId: string,
  visibility: SqlFragment,
): Promise<InactiveEmployeeRow[]> {
  return tx.query<InactiveEmployeeRow>(sql`
    SELECT u.id, u.full_name, u.email::text AS email, u.employee_id, u.status,
           d.name AS department_name, p.name AS position_name, u.left_on::text AS left_on
    FROM app_user u
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
    WHERE u.organization_id = ${organizationId}
      AND u.account_type = 'employee'
      AND u.status IN ('inactive', 'offboarded')
      AND ${visibility}
    ORDER BY u.full_name, u.id
  `);
}
