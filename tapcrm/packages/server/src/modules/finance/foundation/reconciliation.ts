import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export interface ReconciliationSettingsInput {
  readonly bankMode: 'manual_csv' | 'api';
  readonly bankProvider: string | null;
  readonly bankAccountName: string | null;
  readonly bankCurrency: string;
  readonly bankLedgerAccountId: string | null;
  readonly csvDateColumn: string;
  readonly csvReferenceColumn: string;
  readonly csvDescriptionColumn: string;
  readonly csvDebitColumn: string;
  readonly csvCreditColumn: string;
  readonly reason: string;
}

export async function ensureReconciliationSettings(tx: Tx, organizationId: string) {
  await tx.query(sql`
    INSERT INTO finance_reconciliation_settings (organization_id)
    VALUES (${organizationId}) ON CONFLICT (organization_id) DO NOTHING
  `);
}

export async function getReconciliationSettings(ctx: RequestContext) {
  await db.transaction(ctx, (tx) => ensureReconciliationSettings(tx, ctx.organizationId));
  return db.one(ctx, sql`
    SELECT id, organization_id AS "organizationId", bank_mode AS "bankMode",
      bank_provider AS "bankProvider", bank_account_name AS "bankAccountName",
      bank_currency AS "bankCurrency", bank_ledger_account_id AS "bankLedgerAccountId",
      csv_date_column AS "csvDateColumn", csv_reference_column AS "csvReferenceColumn",
      csv_description_column AS "csvDescriptionColumn", csv_debit_column AS "csvDebitColumn",
      csv_credit_column AS "csvCreditColumn", updated_by AS "updatedBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM finance_reconciliation_settings WHERE organization_id=${ctx.organizationId}
  `);
}

export async function updateReconciliationSettings(
  ctx: RequestContext,
  input: ReconciliationSettingsInput,
) {
  await db.transaction(ctx, async (tx) => {
    await ensureReconciliationSettings(tx, ctx.organizationId);
    const before = await tx.one(sql`SELECT * FROM finance_reconciliation_settings WHERE organization_id=${ctx.organizationId} FOR UPDATE`);
    if (input.bankLedgerAccountId) {
      const account = await tx.maybeOne(sql`SELECT id FROM ledger_account WHERE organization_id=${ctx.organizationId} AND id=${input.bankLedgerAccountId} AND is_active=true`);
      if (!account) throw new Error('FINANCE_RECONCILIATION_BANK_ACCOUNT_NOT_FOUND');
    }
    await tx.query(sql`
      UPDATE finance_reconciliation_settings SET bank_mode=${input.bankMode},
        bank_provider=${input.bankProvider}, bank_account_name=${input.bankAccountName},
        bank_currency=${input.bankCurrency}, bank_ledger_account_id=${input.bankLedgerAccountId},
        csv_date_column=${input.csvDateColumn}, csv_reference_column=${input.csvReferenceColumn},
        csv_description_column=${input.csvDescriptionColumn}, csv_debit_column=${input.csvDebitColumn},
        csv_credit_column=${input.csvCreditColumn}, updated_by=${ctx.principal.id}, updated_at=now()
      WHERE organization_id=${ctx.organizationId}
    `);
    const after = await tx.one(sql`SELECT * FROM finance_reconciliation_settings WHERE organization_id=${ctx.organizationId}`);
    await tx.query(sql`
      INSERT INTO audit_outbox (organization_id,stream,payload)
      VALUES (${ctx.organizationId},'activity',${JSON.stringify({ action:'finance.reconciliation.settings.updated', actorId:ctx.principal.id, targetType:'reconciliationSettings', targetId:ctx.organizationId, before, after, reason:input.reason, requestId:ctx.requestId, sourceIp:ctx.sourceIp })}::jsonb)
    `);
  });
  return getReconciliationSettings(ctx);
}
