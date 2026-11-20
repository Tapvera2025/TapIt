import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { NOTIFICATION_TYPES, clip, formatDay, inBatches, notify } from '../notifications/facade.js';

interface OverdueTask {
  id: string;
  title: string;
  createdBy: string;
  assignees: string[];
  assigners: string[];
  dueOn: string;
  localDay: string;
}

export async function remindOverdueTasks(ctx: RequestContext, now: Date): Promise<number> {
  return db.transaction(ctx, async (tx) => {
    const tasks = await tx.query<OverdueTask>(sql`
      SELECT t.id, t.title, t.created_by,
             COALESCE(array_agg(DISTINCT a.user_id) FILTER (WHERE a.user_id IS NOT NULL), '{}') AS assignees,
             COALESCE(array_agg(DISTINCT a.assigned_by) FILTER (WHERE a.assigned_by IS NOT NULL), '{}') AS assigners,
             (t.due_date AT TIME ZONE o.timezone)::date::text AS due_on,
             (${now}::timestamptz AT TIME ZONE o.timezone)::date::text AS local_day
        FROM task t
        JOIN organization o ON o.id = t.organization_id
        LEFT JOIN task_assignee a ON a.organization_id = t.organization_id AND a.task_id = t.id
                                 AND a.status NOT IN ('completed', 'cancelled')
       WHERE t.organization_id = ${ctx.organizationId}
         AND t.status NOT IN ('completed', 'cancelled')
         AND t.due_date < (date_trunc('day', ${now}::timestamptz AT TIME ZONE o.timezone) AT TIME ZONE o.timezone)
       GROUP BY t.id, o.timezone
       ORDER BY t.id
    `);

    for (const task of tasks) {
      const recipients = [...new Set([task.createdBy, ...task.assignees, ...task.assigners])].sort();
      for (const [batchIndex, users] of inBatches(recipients).entries()) {
        await notify(tx, ctx, {
          type: NOTIFICATION_TYPES.TASK_OVERDUE,
          deduplicationKey: `task.overdue:${task.id}:${task.localDay}:${batchIndex}`,
          priority: 'operational',
          audience: { users },
          title: 'Overdue task',
          body: clip(`${task.title} was due ${formatDay(task.dueOn)}.`, 500),
          link: '/company/tasks',
          metadata: { taskId: task.id },
        });
      }
    }
    return tasks.length;
  });
}

export function registerTaskReminderJobs(): void {
  defineJob({
    name: 'tasks.remind-overdue',
    perOrganization: true,
    schedule: { every: 24 * 60 * 60 * 1000 },
    handler: async ({ ctx, clock }) => ({ itemsProcessed: await remindOverdueTasks(ctx, clock.now()) }),
  });
}
