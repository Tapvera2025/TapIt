import { defineJob } from '../../../platform/jobs/runner.js';
import { runStalledLeadSweep } from './stalled-service.js';
import { runCallbackAutomation } from './callback-automation.js';

/** Sales maintenance runs through the durable runner used by the other modules. */
export function registerSalesJobs(): void {
  defineJob({
    name: 'sales.leads.stalled-sweep',
    perOrganization: false,
    schedule: { every: 60 * 60 * 1000 },
    handler: async () => { await runStalledLeadSweep(); },
  });
  defineJob({
    name: 'sales.leads.callback-automation',
    perOrganization: false,
    schedule: { every: 60 * 1000 },
    handler: async () => { await runCallbackAutomation(); },
  });
}
