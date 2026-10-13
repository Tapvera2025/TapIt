import type { DateOnly, OnboardingWorkflowDto } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { PlatformNotFoundError } from '../../platform/errors.js';
import { localDateOf } from '../../platform/time.js';
import {
  completeStep,
  createOnboardingWorkflow,
  findWorkflowByEmployeeId,
  findWorkflowById,
  listWorkflows,
} from './repository.js';
import type { CompleteStepInput, CreateWorkflowInput, ListWorkflowsQuery } from './validators.js';

export async function createWorkflow(
  ctx: RequestContext,
  input: CreateWorkflowInput,
): Promise<OnboardingWorkflowDto> {
  return db.transaction(ctx, async (tx) => {
    const employee = await tx.maybeOne<{ id: string; reportsTo: string | null }>(sql`
      SELECT id, reports_to AS "reportsTo"
      FROM app_user
      WHERE organization_id = ${ctx.organizationId} AND id = ${input.employeeId}
    `);
    if (!employee) {
      throw new PlatformNotFoundError('Employee not found in this organization');
    }

    const startDate = (input.startDate ?? localDateOf(new Date(), 'UTC')) as DateOnly;
    const managerId = input.managerId !== undefined ? input.managerId : employee.reportsTo;

    const result = await createOnboardingWorkflow(tx, {
      organizationId: ctx.organizationId,
      employeeId: input.employeeId,
      createdBy: ctx.principal.id,
      startDate,
      managerId,
    });

    const wf = await findWorkflowById(tx, ctx.organizationId, result.id);
    if (!wf) {
      throw new PlatformNotFoundError('Failed to retrieve created onboarding workflow');
    }
    return wf;
  });
}

export async function getWorkflow(ctx: RequestContext, id: string) {
  return db.transaction(ctx, async (tx) => {
    const wf = await findWorkflowById(tx, ctx.organizationId, id);
    if (!wf) {
      throw new Error('Onboarding workflow not found');
    }
    return wf;
  });
}

export async function getWorkflowForEmployee(ctx: RequestContext, employeeId: string) {
  return db.transaction(ctx, async (tx) => {
    return findWorkflowByEmployeeId(tx, ctx.organizationId, employeeId);
  });
}

export async function listAllWorkflows(ctx: RequestContext, query: ListWorkflowsQuery) {
  return db.transaction(ctx, async (tx) => {
    if (query.employeeId) {
      const wf = await findWorkflowByEmployeeId(tx, ctx.organizationId, query.employeeId);
      return wf ? [wf] : [];
    }
    return listWorkflows(tx, ctx.organizationId, query.status);
  });
}

export async function completeWorkflowStep(
  ctx: RequestContext,
  workflowId: string,
  stepId: string,
  input: CompleteStepInput,
) {
  return db.transaction(ctx, async (tx) => {
    const step = await completeStep(tx, {
      organizationId: ctx.organizationId,
      workflowId,
      stepId,
      completedBy: ctx.principal.id,
      notes: input.notes,
    });
    if (!step) {
      throw new Error('Onboarding step not found or could not be updated');
    }
    return step;
  });
}
