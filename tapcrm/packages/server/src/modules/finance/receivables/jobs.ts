import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';
import { notify } from '../../notifications/facade.js';
import { settlePromiseOutcomes } from './service.js';

export interface ReceivablesJobs {
  readonly reminders: JobHandle<undefined>;
}

export function registerReceivablesJobs(): ReceivablesJobs {
  const reminders = defineJob<undefined>({
    name: 'receivables.reminders',
    perOrganization: true,
    module: 'receivables',
    schedule: { pattern: '0 9 * * *', tz: 'UTC' },
    attempts: 3,
    handler: async ({ ctx, clock }) => {
      const now = clock.now();
      const result = await db.transaction(ctx, async (tx: Tx) => {
        const promisesSettled = await settlePromiseOutcomes(ctx, tx, now);
        const invoices = await tx.query<{
          id: string;
          clientId: string;
          invoiceNumber: string;
          timezone: string;
          cadenceDays: number | null;
        }>(
          sql`SELECT i.id,i.client_id AS "clientId",i.invoice_number AS "invoiceNumber",c.timezone,ds.cadence_days AS "cadenceDays" FROM finance_invoice i JOIN client c ON c.organization_id=i.organization_id AND c.id=i.client_id JOIN finance_invoice_delivery delivery ON delivery.organization_id=i.organization_id AND delivery.invoice_id=i.id AND delivery.status='sent' LEFT JOIN finance_receivable_dunning_schedule ds ON ds.organization_id=i.organization_id AND ds.client_id=i.client_id WHERE i.organization_id=${ctx.organizationId} AND i.status='issued' AND i.due_date <= (${now} AT TIME ZONE c.timezone)::date AND (ds.id IS NULL OR (ds.enabled AND ds.next_run_at <= ${now})) AND i.receivable_status NOT IN ('paid','written_off','disputed') AND NOT EXISTS (SELECT 1 FROM finance_receivable_dispute d WHERE d.organization_id=i.organization_id AND d.invoice_id=i.id AND d.hold_collections AND d.status IN ('open','under_review'))`,
        );
        let created = 0;
        for (const invoice of invoices) {
          const inserted = await tx.maybeOne<{ id: string }>(
            sql`INSERT INTO finance_receivable_reminder (organization_id,invoice_id,reminder_date,local_timezone) VALUES (${ctx.organizationId},${invoice.id},(${now} AT TIME ZONE ${invoice.timezone})::date,${invoice.timezone}) ON CONFLICT (organization_id,invoice_id,reminder_date) DO NOTHING RETURNING id`,
          );
          if (!inserted) continue;
          await tx.query(
            sql`INSERT INTO finance_receivable_collection_task (organization_id,client_id,invoice_id,task_type,due_at,title,reason,created_by) VALUES (${ctx.organizationId},${invoice.clientId},${invoice.id},'reminder',${now},${`Overdue invoice ${invoice.invoiceNumber}`},'Timezone-aware overdue receivable reminder',${ctx.principal.id})`,
          );
          await tx.query(
            sql`INSERT INTO finance_receivable_collection_activity (organization_id,client_id,invoice_id,activity_type,channel,status,scheduled_for,reason,created_by) VALUES (${ctx.organizationId},${invoice.clientId},${invoice.id},'dunning','in_app','scheduled',${now},'Timezone-aware overdue reminder generated',${ctx.principal.id})`,
          );
          await notify(tx, ctx, {
            type: 'receivables.overdue_reminder',
            priority: 'operational',
            audience: { holders: { action: 'receivables:dun' } },
            title: `Overdue invoice ${invoice.invoiceNumber}`,
            body: 'A delivered invoice is overdue and requires collection follow-up.',
            link: '/company/finance/receivables',
            metadata: { invoiceId: invoice.id },
          });
          if (invoice.cadenceDays) {
            await tx.query(
              sql`UPDATE finance_receivable_dunning_schedule SET next_run_at=${now} + (${invoice.cadenceDays} || ' days')::interval,updated_at=now() WHERE organization_id=${ctx.organizationId} AND client_id=${invoice.clientId}`,
            );
          }
          created += 1;
        }
        return { created, promisesSettled };
      });
      return { itemsProcessed: result.created, promisesSettled: result.promisesSettled };
    },
  });
  return { reminders };
}
