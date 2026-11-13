import { defineJob } from '../../platform/jobs/runner.js';
import { runMeetingAutomation } from './automation.js';

export function registerMeetingJobs(): void {
  defineJob({
    name: 'meetings.automation',
    perOrganization: true,
    module: 'meetings',
    schedule: { pattern: '* * * * *' },
    attempts: 1, // the next minute picks up anything still due
    handler: async ({ ctx, clock }) => ({ itemsProcessed: await runMeetingAutomation(ctx, clock.now()) }),
  });
}
