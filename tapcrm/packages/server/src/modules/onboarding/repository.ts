import type { DateOnly, OnboardingStepDto, OnboardingWorkflowDto } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { SEEDED_ONBOARDING_STEPS } from './types.js';

export async function createOnboardingWorkflow(
  tx: Tx,
  input: {
    organizationId: string;
    employeeId: string;
    createdBy: string;
    startDate: DateOnly;
    managerId?: string | null | undefined;
  },
): Promise<{ id: string; status: string }> {
  // Check if a default onboarding template exists; create one if not yet present
  let template = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM lifecycle_template
    WHERE organization_id = ${input.organizationId} AND type = 'onboarding' AND is_default = true
    LIMIT 1
  `);

  if (!template) {
    template = await tx.one<{ id: string }>(sql`
      INSERT INTO lifecycle_template (organization_id, type, name, is_default)
      VALUES (${input.organizationId}, 'onboarding', 'Default Employee Onboarding', true)
      RETURNING id
    `);

    let order = 1;
    for (const step of SEEDED_ONBOARDING_STEPS) {
      await tx.query(sql`
        INSERT INTO lifecycle_template_step (
          organization_id, template_id, code, title, description, owner_role, days_due_offset, step_order
        )
        VALUES (
          ${input.organizationId}, ${template.id}, ${step.code}, ${step.title},
          ${step.description}, ${step.ownerRole}, ${step.daysDueOffset}, ${order++}
        )
      `);
    }
  }

  // Create workflow instance
  const workflow = await tx.one<{ id: string; status: string }>(sql`
    INSERT INTO onboarding_workflow (
      organization_id, employee_id, template_id, status, created_by
    )
    VALUES (
      ${input.organizationId}, ${input.employeeId}, ${template.id}, 'in_progress', ${input.createdBy}
    )
    RETURNING id, status
  `);

  // Load template steps
  const templateSteps = await tx.query<{
    code: string;
    title: string;
    description: string | null;
    ownerRole: string;
    daysDueOffset: number;
    stepOrder: number;
  }>(sql`
    SELECT code, title, description, owner_role, days_due_offset, step_order
    FROM lifecycle_template_step
    WHERE organization_id = ${input.organizationId} AND template_id = ${template.id}
    ORDER BY step_order ASC
  `);

  // Seed checklist steps for this workflow
  for (const step of templateSteps) {
    const ownerId = step.ownerRole === 'manager' && input.managerId ? input.managerId : input.createdBy;
    await tx.query(sql`
      INSERT INTO onboarding_step (
        organization_id, workflow_id, code, title, description,
        owner_id, owner_role, status, due_date, step_order
      )
      VALUES (
        ${input.organizationId}, ${workflow.id}, ${step.code}, ${step.title}, ${step.description},
        ${ownerId}, ${step.ownerRole}, 'pending',
        (${input.startDate}::date + (${step.daysDueOffset} || ' days')::interval)::date,
        ${step.stepOrder}
      )
    `);
  }

  return workflow;
}

export async function findWorkflowById(
  tx: Tx,
  organizationId: string,
  workflowId: string,
): Promise<OnboardingWorkflowDto | null> {
  const row = await tx.maybeOne<{
    id: string;
    employeeId: string;
    employeeName: string;
    employeeEmail: string;
    departmentId: string | null;
    departmentName: string | null;
    status: 'in_progress' | 'completed' | 'cancelled';
    startedAt: string;
    completedAt: string | null;
  }>(sql`
    SELECT w.id, w.employee_id, u.full_name AS employee_name, u.email::text AS employee_email,
           u.department_id, d.name AS department_name,
           w.status, w.started_at::text AS started_at, w.completed_at::text AS completed_at
    FROM onboarding_workflow w
    JOIN app_user u ON u.organization_id = w.organization_id AND u.id = w.employee_id
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    WHERE w.organization_id = ${organizationId} AND w.id = ${workflowId}
  `);

  if (!row) return null;

  const steps = await tx.query<{
    id: string;
    workflowId: string;
    code: string;
    title: string;
    description: string | null;
    ownerId: string | null;
    ownerName: string | null;
    ownerRole: string;
    status: 'pending' | 'completed' | 'skipped';
    dueDate: string;
    completedAt: string | null;
    completedBy: string | null;
    completedByName: string | null;
    notes: string | null;
    stepOrder: number;
  }>(sql`
    SELECT s.id, s.workflow_id, s.code, s.title, s.description,
           s.owner_id, ow.full_name AS owner_name, s.owner_role,
           s.status, s.due_date::text AS due_date,
           s.completed_at::text AS completed_at,
           s.completed_by, cb.full_name AS completed_by_name,
           s.notes, s.step_order
    FROM onboarding_step s
    LEFT JOIN app_user ow ON ow.organization_id = s.organization_id AND ow.id = s.owner_id
    LEFT JOIN app_user cb ON cb.organization_id = s.organization_id AND cb.id = s.completed_by
    WHERE s.organization_id = ${organizationId} AND s.workflow_id = ${workflowId}
    ORDER BY s.step_order ASC
  `);

  const stepDtos: OnboardingStepDto[] = steps.map((s) => ({
    id: s.id,
    workflowId: s.workflowId,
    code: s.code,
    title: s.title,
    description: s.description,
    ownerId: s.ownerId,
    ownerName: s.ownerName,
    ownerRole: s.ownerRole,
    status: s.status,
    dueDate: s.dueDate,
    completedAt: s.completedAt,
    completedBy: s.completedBy,
    completedByName: s.completedByName,
    notes: s.notes,
    stepOrder: s.stepOrder,
  }));

  const completedCount = stepDtos.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const totalCount = stepDtos.length;

  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeEmail: row.employeeEmail,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    steps: stepDtos,
    progress: {
      total: totalCount,
      completed: completedCount,
      percent: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    },
  };
}

export async function findWorkflowByEmployeeId(
  tx: Tx,
  organizationId: string,
  employeeId: string,
): Promise<OnboardingWorkflowDto | null> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM onboarding_workflow
    WHERE organization_id = ${organizationId} AND employee_id = ${employeeId}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (!row) return null;
  return findWorkflowById(tx, organizationId, row.id);
}

export async function listWorkflows(
  tx: Tx,
  organizationId: string,
  status?: string,
): Promise<OnboardingWorkflowDto[]> {
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM onboarding_workflow
    WHERE organization_id = ${organizationId}
      ${status ? sql`AND status = ${status}` : sql``}
    ORDER BY created_at DESC
  `);

  const results: OnboardingWorkflowDto[] = [];
  for (const r of rows) {
    const wf = await findWorkflowById(tx, organizationId, r.id);
    if (wf) results.push(wf);
  }
  return results;
}

export async function completeStep(
  tx: Tx,
  input: {
    organizationId: string;
    workflowId: string;
    stepId: string;
    completedBy: string;
    notes?: string | null | undefined;
  },
): Promise<OnboardingStepDto | null> {
  const updated = await tx.maybeOne<{ id: string }>(sql`
    UPDATE onboarding_step
    SET status = 'completed',
        completed_at = now(),
        completed_by = ${input.completedBy},
        notes = COALESCE(${input.notes ?? null}, notes),
        updated_at = now()
    WHERE organization_id = ${input.organizationId}
      AND workflow_id = ${input.workflowId}
      AND id = ${input.stepId}
    RETURNING id
  `);

  if (!updated) return null;

  // Check if all steps in this workflow are completed
  const pendingCount = await tx.one<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM onboarding_step
    WHERE organization_id = ${input.organizationId}
      AND workflow_id = ${input.workflowId}
      AND status = 'pending'
  `);

  if (parseInt(pendingCount.count, 10) === 0) {
    await tx.query(sql`
      UPDATE onboarding_workflow
      SET status = 'completed',
          completed_at = now(),
          updated_at = now()
      WHERE organization_id = ${input.organizationId}
        AND id = ${input.workflowId}
    `);
  }

  const wf = await findWorkflowById(tx, input.organizationId, input.workflowId);
  return wf?.steps.find((s) => s.id === input.stepId) ?? null;
}
