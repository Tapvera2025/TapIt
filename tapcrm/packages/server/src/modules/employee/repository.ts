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
      reports_to, full_name, must_change_password
    )
    VALUES (
      ${input.organizationId}, 'employee', ${input.employeeId}, ${input.email}, ${input.passwordHash}, 'active', now(),
      ${input.departmentId}, ${input.positionId}, ${input.teamId}, ${input.designationId},
      ${input.specialization}, ${input.reportsTo}, ${input.fullName}, true
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
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox(organization_id, stream, payload)
    VALUES (
      ${input.organizationId}, 'activity',
      ${JSON.stringify({
        action: 'employee.created',
        actorId: input.actorId,
        actorType: input.actorType,
        targetType: 'user',
        targetId: input.targetId,
        before: null,
        after: input.after,
        reason: null,
        requestId: input.requestId,
        sourceIp: input.sourceIp,
      })}::jsonb
    )
  `);
}
