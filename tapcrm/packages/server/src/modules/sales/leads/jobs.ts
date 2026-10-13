import { defineJob } from '../../../platform/jobs/runner.js';
import { runEscalationSweep } from '../approvals/escalation-service.js';
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
  // R-APP-05 — one escalation per request when the 4-business-hour SLA
  // elapses. The handler no-ops when no request is breached.
  defineJob({
    name: 'sales.approvals.escalate-breached',
    perOrganization: false,
    schedule: { every: 60 * 1000 },
    handler: async () => { await runEscalationSweep(); },
  });
}
