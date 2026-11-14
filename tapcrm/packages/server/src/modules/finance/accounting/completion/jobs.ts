import type { RequestContext } from '../../../../platform/dal/context.js';
import { db } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import { defineJob, type JobHandle } from '../../../../platform/jobs/runner.js';
import { getExternalAccountingAdapter } from './adapters.js';

export async function drainAccountingSyncQueue(ctx: RequestContext): Promise<{ processed: number; failed: number }> {
  const pending = await db.query<{ id: string; provider: string; sourceType: string; sourceId: string; payload: Record<string, unknown>; attempts: number }>(ctx, sql`SELECT id,provider,source_type AS "sourceType",source_id AS "sourceId",payload,attempts FROM finance_accounting_sync_queue WHERE organization_id=${ctx.organizationId} AND status='pending' ORDER BY created_at LIMIT 20`);
  let processed = 0;
  let failed = 0;
  for (const item of pending) {
    const adapter = getExternalAccountingAdapter(item.provider);
    if (!adapter) continue;
    const claimed = await db.transaction(ctx, async (tx) => {
      const claimed = await tx.maybeOne<{ id: string }>(sql`UPDATE finance_accounting_sync_queue SET status='processing',attempts=attempts+1,updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${item.id} AND status='pending' RETURNING id`);
      return Boolean(claimed);
    });
    if (!claimed) continue;
    try {
      await adapter.push({ sourceType: item.sourceType, sourceId: item.sourceId, payload: item.payload });
      await db.transaction(ctx, (tx) => tx.query(sql`UPDATE finance_accounting_sync_queue SET status='synced',last_error=NULL,updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${item.id}`));
      processed += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'External accounting synchronization failed.';
      const nextStatus = item.attempts + 1 >= 5 ? 'failed' : 'pending';
      await db.transaction(ctx, (tx) => tx.query(sql`UPDATE finance_accounting_sync_queue SET status=${nextStatus},last_error=${message},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${item.id}`));
      failed += 1;
    }
  }
  return { processed, failed };
}

export interface AccountingCompletionJobs { readonly sync: JobHandle<undefined>; }

export function registerAccountingCompletionJobs(): AccountingCompletionJobs {
  const sync = defineJob<undefined>({
    name: 'accounting.external-sync',
    perOrganization: true,
    module: 'accounting',
    schedule: { pattern: '*/10 * * * *', tz: 'Asia/Kolkata' },
    attempts: 2,
    handler: async ({ ctx }) => {
      const result = await drainAccountingSyncQueue(ctx);
      return { itemsProcessed: result.processed, errorCount: result.failed, details: result };
    },
  });
  return { sync };
}
