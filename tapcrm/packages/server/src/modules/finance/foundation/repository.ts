import type { Tx } from '../../../platform/dal/db.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { FinanceFoundation } from './types.js';
import type { UpdateFinanceFoundationInput } from './validators.js';

const SELECT_FOUNDATION = sql`
  SELECT c.organization_id AS "organizationId", e.id AS "legalEntityId",
         e.legal_name AS "legalName", e.country_code AS "countryCode",
         e.functional_currency AS "functionalCurrency", c.supported_currencies AS "supportedCurrencies",
         e.timezone AS timezone, e.fiscal_year_start_month AS "fiscalYearStartMonth",
         e.status AS status, c.tax_policy_status AS "taxPolicyStatus",
         c.statutory_source_status AS "statutorySourceStatus",
         c.revenue_policy_status AS "revenuePolicyStatus",
         c.payment_provider_status AS "paymentProviderStatus", c.version AS version,
         c.updated_by AS "updatedBy", c.created_at AS "createdAt", c.updated_at AS "updatedAt"
  FROM finance_configuration c
  JOIN finance_legal_entity e
    ON e.organization_id = c.organization_id AND e.id = c.default_legal_entity_id
`;

export async function findFoundation(ctx: RequestContext): Promise<FinanceFoundation | null> {
  return db.maybeOne<FinanceFoundation>(ctx, sql`${SELECT_FOUNDATION} WHERE c.organization_id = ${ctx.organizationId}`);
}

export async function ensureFoundation(tx: Tx, ctx: RequestContext): Promise<void> {
  const existing = await tx.maybeOne<{ organizationId: string }>(sql`
    SELECT organization_id AS "organizationId" FROM finance_configuration
    WHERE organization_id = ${ctx.organizationId}
  `);
  if (existing) return;
  const organization = await tx.one<{ name: string; timezone: string; currency: string }>(sql`
    SELECT name, timezone, currency FROM organization WHERE id = ${ctx.organizationId}
  `);
  const entity = await tx.one<{ id: string }>(sql`
    INSERT INTO finance_legal_entity
      (organization_id, legal_name, country_code, functional_currency, timezone, created_by)
    VALUES (${ctx.organizationId}, ${organization.name}, 'IN', ${organization.currency}, ${organization.timezone}, ${ctx.principal.id})
    ON CONFLICT (organization_id, legal_name) DO UPDATE SET updated_at = finance_legal_entity.updated_at
    RETURNING id
  `);
  await tx.query(sql`
    INSERT INTO finance_configuration (organization_id, default_legal_entity_id, supported_currencies, updated_by)
    VALUES (${ctx.organizationId}, ${entity.id}, ${[organization.currency, 'AUD']}, ${ctx.principal.id})
    ON CONFLICT (organization_id) DO NOTHING
  `);
}

export async function lockFoundation(tx: Tx, organizationId: string): Promise<FinanceFoundation | null> {
  return tx.maybeOne<FinanceFoundation>(sql`${SELECT_FOUNDATION} WHERE c.organization_id = ${organizationId} FOR UPDATE`);
}

export async function updateFoundation(
  tx: Tx,
  ctx: RequestContext,
  input: UpdateFinanceFoundationInput,
): Promise<void> {
  await tx.query(sql`
    UPDATE finance_legal_entity e SET
      legal_name = ${input.legalName}, country_code = ${input.countryCode},
      functional_currency = ${input.functionalCurrency}, timezone = ${input.timezone},
      fiscal_year_start_month = ${input.fiscalYearStartMonth}, status = ${input.status}
    WHERE e.organization_id = ${ctx.organizationId}
      AND e.id = (SELECT default_legal_entity_id FROM finance_configuration WHERE organization_id = ${ctx.organizationId})
  `);
  await tx.query(sql`
    UPDATE finance_configuration SET supported_currencies = ${input.supportedCurrencies},
      tax_policy_status = ${input.taxPolicyStatus}, statutory_source_status = ${input.statutorySourceStatus},
      revenue_policy_status = ${input.revenuePolicyStatus}, payment_provider_status = ${input.paymentProviderStatus},
      version = version + 1, updated_by = ${ctx.principal.id}
    WHERE organization_id = ${ctx.organizationId} AND version = ${input.expectedVersion}
  `);
}
