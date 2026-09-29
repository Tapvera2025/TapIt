import { defineJob } from '../../platform/jobs/runner.js';
import { runAuditRetention } from './archive.js';
import { runDailyAuditIntegrityVerification } from './integrity.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Moved from platform/jobs.ts unchanged. Both walk every organization
 * themselves and write their own `job_run` rows, so they stay platform jobs.
 */
export function registerAuditJobs(): void {
  defineJob({
    name: 'audit.chain-verification',
    perOrganization: false,
    schedule: { every: DAY_MS },
    handler: () => runDailyAuditIntegrityVerification(),
  });
  defineJob({
    name: 'audit.retention',
    perOrganization: false,
    schedule: { every: DAY_MS },
    attempts: 3,
    backoffMs: 60_000,
    handler: () => runAuditRetention(),
  });
}
