import { defineJob } from '../../platform/jobs/runner.js';
import { db } from '../../platform/dal/db.js';
import { pruneExpired } from './repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Notification expiry and processed-outbox cleanup, formerly on the legacy scheduler. */
export function registerNotificationJobs(): void {
  defineJob({
    name: 'notifications.retention',
    perOrganization: true,
    schedule: { every: DAY_MS },
    handler: async ({ ctx }) => {
      const removed = await db.transaction(ctx, (tx) => pruneExpired(tx, ctx.organizationId));
      return { itemsProcessed: removed };
    },
  });
}
