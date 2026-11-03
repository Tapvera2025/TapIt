import type { RequestContext } from '../../../platform/dal/context.js';
import type { Tx } from '../../../platform/dal/db.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { PaymentGatewayConfig, PaymentProvider, PaymentEnvironment } from './types.js';

type ConfigRow = Omit<PaymentGatewayConfig, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
const select = sql`SELECT id, organization_id AS "organizationId", provider, environment,
  public_key AS "publicKey", hyperswitch_connector_id AS "hyperswitchConnectorId",
  supported_currencies AS "supportedCurrencies", is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"
  FROM finance_payment_gateway_config`;

export async function listConfigs(ctx: RequestContext): Promise<PaymentGatewayConfig[]> {
  return db.query<ConfigRow>(ctx, sql`${select} WHERE organization_id = ${ctx.organizationId} ORDER BY provider, environment`);
}

export async function activeConfig(ctx: RequestContext, currency: string): Promise<{ id: string; provider: PaymentProvider; environment: PaymentEnvironment; publicKey: string | null; encryptedSecretKey: string; encryptedWebhookKey: string; hyperswitchConnectorId: string | null } | null> {
  return db.maybeOne(ctx, sql`SELECT id, provider, environment, public_key AS "publicKey",
    encrypted_secret_key AS "encryptedSecretKey", encrypted_webhook_key AS "encryptedWebhookKey",
    hyperswitch_connector_id AS "hyperswitchConnectorId"
    FROM finance_payment_gateway_config
    WHERE organization_id = ${ctx.organizationId} AND is_active = true AND ${currency} = ANY(supported_currencies)
    ORDER BY updated_at DESC LIMIT 1`);
}

export async function insertConfig(tx: Tx, ctx: RequestContext, input: { legalEntityId?: string; provider: PaymentProvider; environment: PaymentEnvironment; publicKey: string; encryptedSecretKey: string; encryptedWebhookKey: string; connectorId?: string; supportedCurrencies: readonly string[] }): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`INSERT INTO finance_payment_gateway_config
    (organization_id, legal_entity_id, provider, environment, public_key, encrypted_secret_key,
     encrypted_webhook_key, hyperswitch_connector_id, supported_currencies, created_by)
    VALUES (${ctx.organizationId}, ${input.legalEntityId ?? null}, ${input.provider}, ${input.environment},
      ${input.publicKey}, ${input.encryptedSecretKey}, ${input.encryptedWebhookKey}, ${input.connectorId ?? null},
      ${input.supportedCurrencies}, ${ctx.principal.id})
    ON CONFLICT (organization_id, provider, environment) DO UPDATE SET
      legal_entity_id = EXCLUDED.legal_entity_id, public_key = EXCLUDED.public_key,
      encrypted_secret_key = EXCLUDED.encrypted_secret_key, encrypted_webhook_key = EXCLUDED.encrypted_webhook_key,
      hyperswitch_connector_id = EXCLUDED.hyperswitch_connector_id, supported_currencies = EXCLUDED.supported_currencies,
      is_active = true, updated_at = now()
    RETURNING id`);
  await tx.query(sql`UPDATE finance_configuration SET payment_provider_status = 'configured', updated_by = ${ctx.principal.id}
    WHERE organization_id = ${ctx.organizationId}`);
  return row.id;
}

export async function deactivateConfig(tx: Tx, ctx: RequestContext, id: string): Promise<void> {
  await tx.query(sql`UPDATE finance_payment_gateway_config SET is_active = false WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
  await tx.query(sql`UPDATE finance_configuration SET payment_provider_status = CASE WHEN EXISTS (
    SELECT 1 FROM finance_payment_gateway_config WHERE organization_id = ${ctx.organizationId} AND is_active
  ) THEN 'configured' ELSE 'pending_review' END, updated_by = ${ctx.principal.id} WHERE organization_id = ${ctx.organizationId}`);
}

export async function findVerifiedReceiptTotal(tx: Tx, organizationId: string, dealId: string): Promise<bigint> {
  const row = await tx.one<{ total: string }>(sql`SELECT COALESCE(SUM(pa.amount_minor), 0)::text AS total
    FROM payment_allocation pa JOIN payment_receipt pr ON pr.organization_id = pa.organization_id AND pr.id = pa.receipt_id
    WHERE pa.organization_id = ${organizationId} AND pa.deal_id = ${dealId} AND pr.state IN ('verified','reconciled')`);
  return BigInt(row.total);
}
