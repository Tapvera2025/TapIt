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

export async function createEmployee(
  tx: Tx,
  input: {
    organizationId: string;
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
    email: string;
    fullName: string;
    accountType: 'employee';
    status: string;
  }>(sql`
    INSERT INTO app_user(
      organization_id, account_type, email, password_hash, status, email_verified_at,
      department_id, position_id, team_id, designation_id, specialization,
      reports_to, full_name, must_change_password
    )
    VALUES (
      ${input.organizationId}, 'employee', ${input.email}, ${input.passwordHash}, 'active', now(),
      ${input.departmentId}, ${input.positionId}, ${input.teamId}, ${input.designationId},
      ${input.specialization}, ${input.reportsTo}, ${input.fullName}, true
    )
    RETURNING id, email, full_name, account_type, status
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
        requestId: input.requestId,
        sourceIp: input.sourceIp,
      })}::jsonb
    )
  `);
}
