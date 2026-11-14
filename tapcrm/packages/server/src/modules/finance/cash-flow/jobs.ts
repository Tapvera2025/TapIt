import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';
import { createForecast } from './service.js';

export interface CashFlowJobs { readonly refresh: JobHandle<undefined>; }

export function registerCashFlowJobs(): CashFlowJobs {
  const refresh = defineJob<undefined>({
    name: 'cash-flow.forecast-refresh',
    perOrganization: true,
    module: 'accounting',
    schedule: { pattern: '0 2 * * *', tz: 'UTC' },
    attempts: 2,
    handler: async ({ ctx, clock }) => {
      const asOfDate = clock.now().toISOString().slice(0, 10);
      const result = await createForecast(ctx, { asOfDate, baseCurrency: 'INR', horizonWeeks: 13, minimumCash: '0', reason: 'Scheduled cash-flow forecast refresh.' });
      return { itemsProcessed: result.horizonWeeks };
    },
  });
  return { refresh };
}
