import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { NOTIFICATION_TYPES, clip, formatDay, notify } from '../notifications/facade.js';

interface OverdueStep {
  id: string;
  title: string;
  ownerId: string | null;
  employeeName: string;
  workflowId: string;
  dueOn: string;
  localDay: string;
}

export async function remindOverdueOnboarding(ctx: RequestContext, now: Date): Promise<number> {
  return db.transaction(ctx, async (tx) => {
    const steps = await tx.query<OverdueStep>(sql`
      SELECT s.id, s.title, s.owner_id, s.workflow_id, s.due_date::text AS due_on,
             u.full_name AS employee_name,
             (${now}::timestamptz AT TIME ZONE o.timezone)::date::text AS local_day
        FROM onboarding_step s
        JOIN onboarding_workflow w ON w.organization_id = s.organization_id AND w.id = s.workflow_id
        JOIN organization o ON o.id = s.organization_id
        JOIN app_user u ON u.organization_id = w.organization_id AND u.id = w.employee_id
       WHERE s.organization_id = ${ctx.organizationId}
         AND w.status = 'in_progress'
         AND s.status = 'pending'
         AND s.due_date < (${now}::timestamptz AT TIME ZONE o.timezone)::date
       ORDER BY s.id
    `);
    for (const step of steps) {
      await notify(tx, ctx, {
        type: NOTIFICATION_TYPES.ONBOARDING_STEP_OVERDUE,
        deduplicationKey: `onboarding.step_overdue:${step.id}:${step.localDay}`,
        priority: 'operational',
        audience: {
          users: step.ownerId ? [step.ownerId] : [],
          holders: { action: 'onboarding:manage', scope: 'all-people' },
        },
        title: 'Overdue onboarding step',
        body: clip(`${step.title} for ${step.employeeName} was due ${formatDay(step.dueOn)}.`, 500),
        link: '/company/employees',
        metadata: { workflowId: step.workflowId, stepId: step.id },
      });
    }
    return steps.length;
  });
}

export function registerOnboardingReminderJobs(): void {
  defineJob({
    name: 'onboarding.remind-overdue',
    perOrganization: true,
    schedule: { every: 24 * 60 * 60 * 1000 },
    handler: async ({ ctx, clock }) => ({ itemsProcessed: await remindOverdueOnboarding(ctx, clock.now()) }),
  });
}
