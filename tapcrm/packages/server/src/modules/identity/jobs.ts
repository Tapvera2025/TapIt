import { db } from '../../platform/dal/db.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { purgeExpiredCoordinates } from './geofence/privacy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Moved from platform/jobs.ts unchanged, now one run per organization (JB-2, JB-3). */
export function registerIdentityJobs(): void {
  defineJob({
    name: 'identity.purge-geofence-coordinates',
    perOrganization: true,
    schedule: { every: DAY_MS },
    handler: async ({ ctx }) => {
      await db.transaction(ctx, purgeExpiredCoordinates);
    },
  });
}
