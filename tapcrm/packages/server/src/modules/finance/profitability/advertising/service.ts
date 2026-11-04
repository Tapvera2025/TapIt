import { createHash } from 'node:crypto';
import { db } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import type { RequestContext } from '../../../../platform/dal/context.js';
import { encryptSecret, decryptSecret } from '../../payments/crypto.js';
import { ProfitabilityError } from '../errors.js';
import { audit } from '../service.js';
import { adapterFor } from './adapter.js';
import type { AdvertisingAccountInput, AdvertisingCredentialsInput, AdvertisingSyncInput, ManualSpendInput } from '../validators.js';

function validateProviderCredentials(provider: string, credentials: Record<string, string> | undefined): void {
  if (provider === 'manual') return;
  const required = provider === 'google_ads' ? ['accessToken', 'developerToken'] : ['accessToken'];
  if (!credentials || required.some((key) => !credentials[key]?.trim())) {
    throw new ProfitabilityError(`${provider === 'google_ads' ? 'Google Ads' : 'Meta Ads'} requires ${required.join(' and ')} credentials.`);
  }
}

export async function createAccount(ctx: RequestContext, input: AdvertisingAccountInput) {
  if (input.fundingModel === 'client_funded' && !input.clientId) throw new ProfitabilityError('Client-funded advertising accounts require a client.');
  if (input.fundingModel === 'shared' && !input.projectId && !input.clientId) throw new ProfitabilityError('Shared advertising accounts require a project or client.');
  validateProviderCredentials(input.provider, input.credentials);
  const credentials = input.credentials ? encryptSecret(JSON.stringify(input.credentials)) : null;
  if (input.projectId) {
    const p = await db.maybeOne<{ clientId: string; currency: string }>(ctx, sql`SELECT client_id AS "clientId",currency FROM project WHERE organization_id=${ctx.organizationId} AND id=${input.projectId} AND archived_at IS NULL`);
    if (!p) throw new ProfitabilityError('Active project not found.', 404);
    if (input.clientId && input.clientId !== p.clientId) throw new ProfitabilityError('Advertising project and client must belong together.');
    if (p.currency !== input.currency) throw new ProfitabilityError('Advertising currency must match the project currency.');
  }
  if (input.clientId) {
    const client = await db.maybeOne<{ id: string; currency: string | null }>(ctx, sql`SELECT id,currency FROM client WHERE organization_id=${ctx.organizationId} AND id=${input.clientId} AND status='active'`);
    if (!client) throw new ProfitabilityError('Active client not found.', 404);
    if (client.currency && client.currency !== input.currency) throw new ProfitabilityError('Advertising currency must match the client currency.');
  }
  const status = input.provider === 'manual' || credentials ? 'active' : 'needs_review';
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string; name: string; provider: string; status: string }>(sql`INSERT INTO finance_advertising_account (organization_id,provider,external_account_id,name,project_id,client_id,funding_model,currency,encrypted_credentials,freshness_hours,status,created_by) VALUES (${ctx.organizationId},${input.provider},${input.externalAccountId},${input.name},${input.projectId ?? null},${input.clientId ?? null},${input.fundingModel},${input.currency},${credentials},${input.freshnessHours},${status},${ctx.principal.id}) RETURNING id,name,provider,status`);
    await audit(ctx, tx, 'profitability.advertising.account.created', row.id, input.reason, { ...input, credentials: input.credentials ? '[encrypted]' : null });
    return row;
  });
}

export async function configureCredentials(ctx: RequestContext, accountId: string, input: AdvertisingCredentialsInput) {
  const account = await db.maybeOne<{ provider: string }>(ctx, sql`SELECT provider FROM finance_advertising_account WHERE organization_id=${ctx.organizationId} AND id=${accountId}`);
  if (!account) throw new ProfitabilityError('Advertising account not found.', 404);
  if (account.provider === 'manual') throw new ProfitabilityError('Manual advertising accounts do not accept provider credentials.');
  validateProviderCredentials(account.provider, input.credentials);
  const encrypted = encryptSecret(JSON.stringify(input.credentials));
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string; status: string }>(sql`UPDATE finance_advertising_account SET encrypted_credentials=${encrypted},status='active',last_sync_status=NULL,last_sync_message=NULL,updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${accountId} RETURNING id,status`);
    await audit(ctx, tx, 'profitability.advertising.credentials.configured', accountId, input.reason, { credentials: '[encrypted]' });
    return row;
  });
}

export async function createManualSpend(ctx: RequestContext, accountId: string, input: ManualSpendInput) {
  const account = await db.maybeOne<{ provider: string; projectId: string | null; clientId: string | null; currency: string }>(ctx, sql`SELECT provider,project_id AS "projectId",client_id AS "clientId",currency FROM finance_advertising_account WHERE organization_id=${ctx.organizationId} AND id=${accountId} AND status='active'`);
  if (!account) throw new ProfitabilityError('Advertising account not found or paused.', 404);
  if (account.provider !== 'manual') throw new ProfitabilityError('Manual spend can only be entered for a manual advertising account.');
  if (account.currency !== input.currency) throw new ProfitabilityError('Spend currency must match the advertising account currency.');
  return db.transaction(ctx, async (tx) => {
    const rows = await tx.query<{ id: string; externalSpendId: string; amount: string }>(sql`INSERT INTO finance_advertising_spend (organization_id,account_id,project_id,client_id,external_spend_id,spend_date,campaign_name,amount,currency,raw_payload_hash) VALUES (${ctx.organizationId},${accountId},${account.projectId},${account.clientId},${input.externalSpendId},${input.spendDate},${input.campaignName ?? null},${input.amount},${input.currency},${createHash('sha256').update(JSON.stringify(input)).digest('hex')}) ON CONFLICT (organization_id,account_id,external_spend_id) DO NOTHING RETURNING id,external_spend_id AS "externalSpendId",amount`);
    if (rows[0]) await audit(ctx, tx, 'profitability.advertising.manual_spend.created', rows[0].id, input.reason, { externalSpendId: input.externalSpendId, amount: input.amount });
    return rows;
  });
}

export async function syncAccount(ctx: RequestContext, accountId: string, input: AdvertisingSyncInput) {
  const account = await db.maybeOne<{ id: string; provider: 'google_ads' | 'meta_ads' | 'manual'; externalAccountId: string; encryptedCredentials: string | null; projectId: string | null; clientId: string | null; currency: string }>(ctx, sql`SELECT id,provider,external_account_id AS "externalAccountId",encrypted_credentials AS "encryptedCredentials",project_id AS "projectId",client_id AS "clientId",currency FROM finance_advertising_account WHERE organization_id=${ctx.organizationId} AND id=${accountId} AND status='active'`);
  if (!account) throw new ProfitabilityError('Advertising account not found or paused.', 404);
  if (!account.encryptedCredentials) throw new ProfitabilityError('Advertising account credentials are not configured.');
  const credentials = JSON.parse(decryptSecret(account.encryptedCredentials)) as Record<string, string>;
  const sync = await db.query(ctx, sql`INSERT INTO finance_advertising_sync (organization_id,account_id,period_start,period_end,status) VALUES (${ctx.organizationId},${accountId},${input.periodStart},${input.periodEnd},'running') RETURNING id`);
  const syncId = (sync[0] as { id: string }).id;
  try {
    const spend = await adapterFor(account.provider).fetchSpend({ externalAccountId: account.externalAccountId, credentials, periodStart: input.periodStart, periodEnd: input.periodEnd });
    let imported = 0;
    await db.transaction(ctx, async (tx) => {
      for (const item of spend) {
        if (item.currency !== account.currency) throw new ProfitabilityError(`Advertising provider returned ${item.currency}, but this account is configured for ${account.currency}. Configure a matching account or currency conversion policy.`);
        const hash = createHash('sha256').update(JSON.stringify(item.rawPayload)).digest('hex');
        const inserted = await tx.maybeOne<{ id: string }>(sql`INSERT INTO finance_advertising_spend (organization_id,account_id,project_id,client_id,external_spend_id,spend_date,campaign_name,amount,currency,raw_payload_hash) VALUES (${ctx.organizationId},${accountId},${account.projectId},${account.clientId},${item.externalSpendId},${item.spendDate},${item.campaignName},${item.amount},${item.currency},${hash}) ON CONFLICT (organization_id,account_id,external_spend_id) DO NOTHING RETURNING id`);
        if (inserted) imported += 1;
      }
      await tx.query(sql`UPDATE finance_advertising_sync SET status='succeeded',records_imported=${imported},finished_at=now() WHERE organization_id=${ctx.organizationId} AND id=${syncId}`);
      await tx.query(sql`UPDATE finance_advertising_account SET last_sync_at=now(),last_sync_status='succeeded',last_sync_message=${`Imported ${imported} spend records`},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${accountId}`);
    });
    return { accountId, syncId, imported };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Advertising sync failed.';
    await db.query(ctx, sql`UPDATE finance_advertising_sync SET status='failed',error_message=${message},finished_at=now() WHERE organization_id=${ctx.organizationId} AND id=${syncId}`);
    await db.query(ctx, sql`UPDATE finance_advertising_account SET last_sync_status='failed',last_sync_message=${message},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${accountId}`);
    throw cause;
  }
}
