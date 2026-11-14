import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';

export interface PayablesJobs { readonly subscriptions: JobHandle<undefined>; }

export function registerPayablesJobs(): PayablesJobs {
  const subscriptions = defineJob<undefined>({
    name: 'payables.subscription-bills',
    perOrganization: true,
    module: 'payables',
    schedule: { pattern: '0 2 * * *', tz: 'UTC' },
    attempts: 3,
    handler: async ({ ctx, clock }) => {
      const created = await db.transaction(ctx, async (tx: Tx) => {
        const due = await tx.query<{ id: string; vendorId: string; name: string; amount: string; currency: string; nextDueDate: string; recurrence: string; createdBy: string }>(
          sql`SELECT id,vendor_id AS "vendorId",name,amount::text,currency,next_due_date AS "nextDueDate",recurrence,created_by AS "createdBy" FROM finance_payable_subscription WHERE organization_id=${ctx.organizationId} AND status='active' AND next_due_date <= (${clock.now()} AT TIME ZONE 'UTC')::date FOR UPDATE`,
        );
        let count = 0;
        for (const subscription of due) {
          const inserted = await tx.maybeOne<{ id: string }>(sql`INSERT INTO finance_payable_bill (organization_id,vendor_id,source_type,source_id,source_period,invoice_number,issue_date,due_date,currency,subtotal,total,extraction_status,status,duplicate_key,created_by) VALUES (${ctx.organizationId},${subscription.vendorId},'subscription',${subscription.id},${subscription.nextDueDate},${`SUB-${subscription.id.slice(0, 12)}-${subscription.nextDueDate}`},${subscription.nextDueDate},${subscription.nextDueDate},${subscription.currency},${subscription.amount},${subscription.amount},'manual','needs_review',${`subscription:${subscription.id}:${subscription.nextDueDate}`},${subscription.createdBy}) ON CONFLICT (organization_id,source_type,source_id,source_period) DO NOTHING RETURNING id`);
          await tx.query(sql`UPDATE finance_payable_subscription SET next_due_date=CASE recurrence WHEN 'monthly' THEN next_due_date + interval '1 month' WHEN 'quarterly' THEN next_due_date + interval '3 months' ELSE next_due_date + interval '1 year' END,updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${subscription.id}`);
          if (inserted) count += 1;
        }
        return count;
      });
      return { itemsProcessed: created };
    },
  });
  return { subscriptions };
}
