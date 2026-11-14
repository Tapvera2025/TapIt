import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { scanLeakage } from './service.js';

export interface ProfitabilityJobs { readonly leakage: JobHandle<undefined>; }

export function registerProfitabilityJobs(): ProfitabilityJobs {
  const leakage = defineJob<undefined>({
    name: 'profitability.leakage-scan',
    perOrganization: true,
    module: 'projects',
    schedule: { pattern: '0 3 * * *', tz: 'UTC' },
    attempts: 2,
    handler: async ({ ctx, clock }) => {
      const end = clock.now().toISOString().slice(0, 10);
      const startDate = new Date(clock.now());
      startDate.setUTCDate(startDate.getUTCDate() - 30);
      const result = await scanLeakage(ctx, startDate.toISOString().slice(0, 10), end);
      await db.query(ctx, sql`UPDATE finance_advertising_account SET last_sync_message=CASE WHEN last_sync_at IS NULL OR last_sync_at < now() - make_interval(hours => freshness_hours) THEN 'Spend data is stale; refresh or use manual import.' ELSE last_sync_message END WHERE organization_id=${ctx.organizationId} AND status='active'`);
      return { itemsProcessed: result.findings };
    },
  });
  return { leakage };
}
