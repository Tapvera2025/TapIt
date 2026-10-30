import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';

export interface BillingTermsJobs { readonly lifecycle: JobHandle<undefined>; }

/**
 * Daily commercial lifecycle sweep. It only advances billing-term state and
 * creates idempotent billing candidates; invoice issue/send remains owned by
 * the invoicing phase.
 */
export function registerBillingTermsJobs(): BillingTermsJobs {
  const lifecycle = defineJob<undefined>({
    name: 'billing-terms.lifecycle',
    perOrganization: true,
    module: 'billing-terms',
    schedule: { pattern: '15 1 * * *', tz: 'Asia/Kolkata' },
    attempts: 3,
    handler: async ({ ctx, clock }) => {
      const today = clock.now().toISOString().slice(0, 10);
      const result = await db.transaction(ctx, async (tx) => {
        const renewed = await tx.query<{ id:string; endDate:string; term:number }>(sql`
          UPDATE finance_contract
          SET end_date = (end_date + make_interval(months => renewal_term_months)),
              version = version + 1, status = 'active'
          WHERE organization_id=${ctx.organizationId} AND status='active' AND auto_renew=true
            AND renewal_term_months IS NOT NULL AND end_date IS NOT NULL
            AND end_date < ${today}::date
          RETURNING id, end_date AS "endDate", renewal_term_months AS term
        `);
        const expired = await tx.query<{ id:string }>(sql`
          UPDATE finance_contract SET status='expired'
          WHERE organization_id=${ctx.organizationId} AND status IN ('draft','active')
            AND (auto_renew=false OR renewal_term_months IS NULL OR end_date IS NULL)
            AND end_date IS NOT NULL AND end_date < ${today}::date
          RETURNING id
        `);
        for (const row of renewed) {
          await tx.query(sql`INSERT INTO audit_outbox (organization_id, stream, payload) VALUES (${ctx.organizationId}, 'finance', ${JSON.stringify({ action:'billing.contract.auto_renewed', actorId:ctx.principal.id, actorType:ctx.principal.accountType, targetType:'financeCommercial', targetId:row.id, after:{ endDate:row.endDate, termMonths:row.term }, reason:'Scheduled contract lifecycle renewal', requestId:ctx.requestId, sourceIp:null })}::jsonb)`);
        }
        for (const row of expired) {
          await tx.query(sql`INSERT INTO audit_outbox (organization_id, stream, payload) VALUES (${ctx.organizationId}, 'finance', ${JSON.stringify({ action:'billing.contract.expired', actorId:ctx.principal.id, actorType:ctx.principal.accountType, targetType:'financeCommercial', targetId:row.id, after:{ status:'expired' }, reason:'Scheduled contract lifecycle expiry', requestId:ctx.requestId, sourceIp:null })}::jsonb)`);
        }
        const candidates = await tx.query<{ id:string }>(sql`
          INSERT INTO finance_billable_event (organization_id, client_id, contract_id, source_type, source_id, service_key, event_date, currency, quantity, amount, idempotency_key, created_by)
          SELECT s.organization_id, c.client_id, c.id, 'billing_schedule', s.id, 'scheduled-billing', s.next_bill_date, c.currency, 1, 0,
                 'schedule:' || s.id || ':' || s.next_bill_date::text, ${ctx.principal.id}
          FROM finance_billing_schedule s JOIN finance_contract c ON c.organization_id=s.organization_id AND c.id=s.contract_id
          WHERE s.organization_id=${ctx.organizationId} AND s.status='active' AND s.next_bill_date <= ${today}::date AND c.status='active'
          ON CONFLICT (organization_id,idempotency_key) DO NOTHING
          RETURNING id
        `);
        await tx.query(sql`
          UPDATE finance_billing_schedule SET next_bill_date = CASE recurrence
            WHEN 'monthly' THEN next_bill_date + interval '1 month'
            WHEN 'quarterly' THEN next_bill_date + interval '3 months'
            WHEN 'annual' THEN next_bill_date + interval '1 year'
            ELSE next_bill_date
          END
          WHERE organization_id=${ctx.organizationId} AND status='active' AND next_bill_date <= ${today}::date AND recurrence <> 'once'
        `);
        return { renewed:renewed.length, expired:expired.length, candidates:candidates.length };
      });
      return { itemsProcessed: result.renewed + result.expired + result.candidates, details: result };
    },
  });
  return { lifecycle };
}
