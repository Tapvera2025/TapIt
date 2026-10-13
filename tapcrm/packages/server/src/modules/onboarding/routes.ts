import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import {
  completeWorkflowStep,
  createWorkflow,
  listAllWorkflows,
} from './service.js';
import {
  completeStepSchema,
  createWorkflowSchema,
  listWorkflowsQuerySchema,
} from './validators.js';

async function onboardingResource(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<Record<string, unknown>>(
    ctx,
    sql`
      SELECT id, organization_id AS "organizationId", employee_id AS "employeeId"
      FROM onboarding_workflow
      WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `,
  );
  return row === null ? null : { ...row, type: 'onboardingWorkflow' as const, id };
}

export function registerOnboardingRoutes(): void {
  route({
    method: 'GET',
    path: '/api/onboarding',
    action: 'onboarding:manage',
    module: 'onboarding',
    handler: async ({ ctx, query }) =>
      listAllWorkflows(ctx, listWorkflowsQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/onboarding',
    action: 'onboarding:manage',
    module: 'onboarding',
    handler: async ({ ctx, body }) =>
      createWorkflow(ctx, createWorkflowSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/onboarding/:id/steps/:stepId/complete',
    action: 'onboarding:manage',
    module: 'onboarding',
    resourceParam: 'id',
    loadResource: onboardingResource,
    handler: async ({ ctx, params, body }) =>
      completeWorkflowStep(
        ctx,
        params['id']!,
        params['stepId']!,
        completeStepSchema.parse(body),
      ),
  });
}
