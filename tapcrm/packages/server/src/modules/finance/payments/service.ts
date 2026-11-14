import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { platformDb } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { postSourceJournalTx, refreshInvoiceStatus } from '../facade.js';
import { encryptSecret, decryptSecret, generateWebhookSecret } from './crypto.js';
import { createOrUpdateConnector, createPaymentSession } from './hyperswitch-client.js';
import { registerProviderWebhook } from './auto-webhook-registrar.js';
import {
  activeConfig,
  deactivateConfig,
  insertConfig,
  listConfigs,
  findVerifiedReceiptTotal,
} from './repository.js';
import type { CreateLinkInput, ProviderConfigInput } from './validators.js';

function textValue(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}
function webhookStatus(
  body: Record<string, unknown>,
  metadata: Record<string, unknown>,
): 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' {
  const value = (
    textValue(body['status']) ??
    textValue(body['event_type']) ??
    textValue(metadata['status']) ??
    ''
  ).toLowerCase();
  if (value.includes('refund')) return 'refunded';
  if (value.includes('fail') || value.includes('declin') || value.includes('cancel'))
    return 'failed';
  if (value.includes('author')) return 'authorized';
  if (
    value.includes('captur') ||
    value.includes('success') ||
    value.includes('paid') ||
    value.includes('succeed')
  )
    return 'captured';
  return 'pending';
}

export async function getConfigs(ctx: RequestContext) {
  return listConfigs(ctx);
}

async function validateCredentials(
  provider: ProviderConfigInput['provider'],
  apiKey: string,
  secretKey: string,
): Promise<void> {
  const url =
    provider === 'razorpay'
      ? 'https://api.razorpay.com/v1/payments?count=1'
      : provider === 'stripe'
        ? 'https://api.stripe.com/v1/balance'
        : null;
  if (!url) return;
  const headers =
    provider === 'razorpay'
      ? {
          authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`,
        }
      : { authorization: `Bearer ${secretKey}` };
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    console.warn(
      `[Payments] Credential verification network check skipped for ${provider}:`,
      error,
    );
    return;
  }

  if (!response.ok) {
    throw new ApplicationError(
      `Invalid credentials for ${provider} (status: ${response.status}). Please check your Key and Secret.`,
      422,
      'PAYMENT_PROVIDER_CREDENTIALS_INVALID',
      { provider, status: response.status },
    );
  }
}

export async function saveProvider(ctx: RequestContext, input: ProviderConfigInput) {
  await validateCredentials(input.provider, input.publicKey, input.secretKey);
  const webhookSecret = generateWebhookSecret();
  const registration = await registerProviderWebhook(
    input.provider,
    input.publicKey,
    input.secretKey,
    webhookSecret,
  );
  const connector = await createOrUpdateConnector(ctx.organizationId, input.provider, {
    apiKey: input.publicKey,
    apiSecret: input.secretKey,
    environment: input.environment,
  });
  const id = await db.transaction(ctx, async (tx) => {
    const configInput = {
      provider: input.provider,
      environment: input.environment,
      publicKey: input.publicKey,
      encryptedSecretKey: encryptSecret(input.secretKey),
      encryptedWebhookKey: encryptSecret(webhookSecret),
      supportedCurrencies: input.supportedCurrencies,
    } as const;
    const configId = await insertConfig(
      tx,
      ctx,
      input.legalEntityId
        ? {
            ...configInput,
            legalEntityId: input.legalEntityId,
            ...((connector.connectorId ?? registration.id)
              ? { connectorId: connector.connectorId ?? registration.id }
              : {}),
          }
        : {
            ...configInput,
            ...((connector.connectorId ?? registration.id)
              ? { connectorId: connector.connectorId ?? registration.id }
              : {}),
          },
    );
    await tx.query(
      sql`INSERT INTO audit_outbox (organization_id, stream, payload) VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({ action: 'finance.payment_gateway.connected', actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'paymentGateway', targetId: configId, after: { provider: input.provider, environment: input.environment }, reason: input.reason, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)`,
    );
    return configId;
  });
  return (await getConfigs(ctx)).find((item) => item.id === id) ?? null;
}

export async function disconnectProvider(
  ctx: RequestContext,
  id: string,
  reason: string,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    await deactivateConfig(tx, ctx, id);
    await tx.query(
      sql`INSERT INTO audit_outbox (organization_id, stream, payload) VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({ action: 'finance.payment_gateway.disconnected', actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'paymentGateway', targetId: id, reason, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)`,
    );
  });
}

export async function generateLink(ctx: RequestContext, input: CreateLinkInput) {
  const config = await activeConfig(ctx, input.currency);
  if (!config) throw new Error('PAYMENT_PROVIDER_NOT_CONFIGURED');
  const provider = input.provider ?? config.provider;
  const idempotencyKey =
    input.idempotencyKey ??
    `payment:${provider}:${input.referenceType}:${input.referenceId}:${input.amountMinor.toString()}:${input.currency}`;
  const existing = await db.maybeOne<{
    paymentId: string;
    checkoutUrl: string | null;
    provider: string;
  }>(
    ctx,
    sql`SELECT provider_payment_id AS "paymentId", checkout_url AS "checkoutUrl", provider FROM finance_payment WHERE organization_id = ${ctx.organizationId} AND idempotency_key = ${idempotencyKey}`,
  );
  if (existing?.checkoutUrl)
    return {
      checkoutUrl: existing.checkoutUrl,
      paymentId: existing.paymentId,
      provider: existing.provider,
      referenceId: input.referenceId,
    };
  const result = await createPaymentSession({
    merchantId: ctx.organizationId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    referenceId: input.referenceId,
    referenceType: input.referenceType,
    returnUrl: input.returnUrl,
    provider,
  });
  if (!result.checkoutUrl) throw new Error('PAYMENT_CHECKOUT_URL_MISSING');
  await db.transaction(ctx, async (tx) => {
    await tx.query(
      sql`INSERT INTO finance_payment (organization_id, provider, provider_payment_id, reference_type, reference_id, amount_minor, currency, status, idempotency_key, checkout_url, created_by) VALUES (${ctx.organizationId}, ${provider}, ${result.paymentId ?? null}, ${input.referenceType}, ${input.referenceId}, ${input.amountMinor}, ${input.currency}, 'created', ${idempotencyKey}, ${result.checkoutUrl}, ${ctx.principal.id}) ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
    );
  });
  return {
    checkoutUrl: result.checkoutUrl,
    paymentId: result.paymentId ?? null,
    provider,
    referenceId: input.referenceId,
  };
}

function validSignature(
  secret: string,
  raw: Buffer,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const supplied = header
    .replace(/^sha256=/, '')
    .trim()
    .toLowerCase();
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return (
    supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}

export async function handleWebhook(
  rawPayload: Buffer,
  signature: string | undefined,
  hints: { organizationId?: string; provider?: string } = {},
): Promise<{ accepted: boolean; duplicate: boolean }> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawPayload.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('PAYMENT_WEBHOOK_MALFORMED');
  }
  const metadata = (body['metadata'] ?? body['data'] ?? {}) as Record<string, unknown>;
  const organizationId =
    hints.organizationId ??
    textValue(metadata['organization_id']) ??
    textValue(metadata['organizationId']) ??
    textValue(body['organization_id']) ??
    '';
  const eventId =
    textValue(body['id']) ??
    textValue(body['event_id']) ??
    textValue(body['eventId']) ??
    '';
  const provider =
    hints.provider ??
    textValue(body['provider']) ??
    textValue(metadata['provider']) ??
    'stripe';
  const status = webhookStatus(body, metadata);
  if (!organizationId || !eventId)
    throw new Error('PAYMENT_WEBHOOK_TENANT_OR_EVENT_MISSING');
  const config = await platformDb.maybeOne<{ encryptedWebhookKey: string }>(
    'webhook-dispatch',
    'resolve payment webhook tenant configuration',
    sql`SELECT encrypted_webhook_key AS "encryptedWebhookKey" FROM finance_payment_gateway_config WHERE organization_id = ${organizationId} AND is_active = true AND provider = ${provider} LIMIT 1`,
  );
  // Webhook verification is tenant-scoped. A process-wide secret could allow a
  // valid signature from one organization to be replayed against another.
  const webhookSecret = config ? decryptSecret(config.encryptedWebhookKey) : null;
  if (!config || !webhookSecret || !validSignature(webhookSecret, rawPayload, signature))
    throw new Error('PAYMENT_WEBHOOK_SIGNATURE_INVALID');
  const referenceType =
    textValue(metadata['reference_type']) ??
    textValue(metadata['referenceType']) ??
    'deal';
  const referenceId =
    textValue(metadata['referenceId']) ??
    textValue(metadata['reference_id']) ??
    textValue(body['reference_id']);
  const dealId =
    textValue(metadata['deal_id']) ??
    textValue(metadata['dealId']) ??
    (referenceType === 'deal' ? referenceId : null);
  const invoiceId =
    textValue(metadata['invoice_id']) ??
    textValue(metadata['invoiceId']) ??
    (referenceType === 'invoice' ? referenceId : null);
  const amountText =
    textValue(body['amount_minor']) ??
    textValue(body['amountMinor']) ??
    textValue(metadata['amount_minor']) ??
    '0';
  const amountMinor = BigInt(amountText);
  const currency =
    textValue(body['currency']) ?? textValue(metadata['currency']) ?? 'INR';
  if (status === 'captured' && ((!dealId && !invoiceId) || amountMinor <= 0n))
    throw new Error('PAYMENT_WEBHOOK_REFERENCE_OR_AMOUNT_MISSING');
  const feeMinor = BigInt(
    textValue(body['fee_minor']) ?? textValue(metadata['fee_minor']) ?? '0',
  );
  if (status === 'captured' && (feeMinor < 0n || feeMinor > amountMinor))
    throw new Error('PAYMENT_WEBHOOK_FEE_INVALID');
  const providerPaymentId =
    textValue(body['payment_id']) ??
    textValue(body['paymentId']) ??
    textValue(metadata['payment_id']) ??
    textValue(metadata['paymentId']);
  const inserted = await platformDb.maybeOne<{ id: string }>(
    'webhook-dispatch',
    'deduplicate payment webhook event',
    sql`INSERT INTO payment_webhook_event (organization_id, provider, event_id, raw_payload, signature_valid) VALUES (${organizationId}, ${provider}, ${eventId}, ${rawPayload}, true) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
  );
  if (!inserted) return { accepted: true, duplicate: true };
  if (status !== 'captured') {
    await platformDb.transactionForOrganization(
      organizationId,
      'webhook-dispatch',
      'apply non-captured payment webhook status',
      async (tx) => {
        const failureCode =
          textValue(body['failure_code']) ??
          textValue(body['failureCode']) ??
          textValue(metadata['failure_code']);
        await tx.query(
          sql`UPDATE finance_payment SET status=${status},failure_code=${failureCode},updated_at=now() WHERE organization_id=${organizationId} AND (provider_payment_id=${providerPaymentId} OR reference_id=${referenceId})`,
        );
        if (status === 'failed' || status === 'refunded')
          await tx.query(
            sql`INSERT INTO finance_payment_exception (organization_id,exception_type,status,reason,payload) VALUES (${organizationId},${status === 'failed' ? 'payment_failed' : 'payment_refunded'},'open',${status === 'failed' ? 'Provider reported a failed payment.' : 'Provider reported a refund requiring review.'},${JSON.stringify({ provider, eventId, providerPaymentId, referenceId, failureCode })}::jsonb)`,
          );
        await tx.query(
          sql`UPDATE payment_webhook_event SET processed_at=now(),outcome='applied',outcome_reason=${`Payment status ${status}`} WHERE id=${inserted.id}`,
        );
      },
    );
    return { accepted: true, duplicate: false };
  }
  await platformDb.transactionForOrganization(
    organizationId,
    'webhook-dispatch',
    'apply verified payment webhook',
    async (tx) => {
      const actor = await tx.one<{ id: string }>(
        sql`SELECT id FROM app_user WHERE organization_id = ${organizationId} ORDER BY created_at LIMIT 1`,
      );
      const invoiceBalance = invoiceId
        ? await tx.maybeOne<{ outstanding: string }>(sql`SELECT GREATEST(
            round(i.total * 100)::bigint-COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocation pa WHERE pa.organization_id=i.organization_id AND pa.invoice_id=i.id),0),0
          )::text AS outstanding FROM finance_invoice i
          WHERE i.organization_id=${organizationId} AND i.id=${invoiceId} AND i.status='issued' FOR SHARE`)
        : null;
      const invoiceOutstanding = invoiceBalance
        ? BigInt(invoiceBalance.outstanding)
        : null;
      const invoiceAllocation =
        invoiceOutstanding !== null && amountMinor <= invoiceOutstanding
          ? amountMinor
          : 0n;
      const cashClassification =
        referenceType === 'invoice' && invoiceAllocation === amountMinor
          ? 'receivable'
          : referenceType === 'invoice'
            ? 'unapplied'
            : 'advance';
      const receipt = await tx.one<{ id: string }>(
        sql`INSERT INTO payment_receipt (organization_id, provider, provider_event_id, provider_payment_id, amount_minor, currency, received_at, reported_by, fee_minor, cash_classification, verified_by, verified_at, state, note) VALUES (${organizationId}, ${provider}, ${eventId}, ${providerPaymentId}, ${amountMinor}, ${currency}, now(), ${actor.id}, ${feeMinor}, ${cashClassification}, ${actor.id}, now(), 'verified', 'Verified provider webhook') ON CONFLICT (organization_id, provider, provider_event_id) DO UPDATE SET state = 'verified', provider_payment_id = COALESCE(payment_receipt.provider_payment_id, EXCLUDED.provider_payment_id), fee_minor = EXCLUDED.fee_minor RETURNING id`,
      );
      if (dealId) {
        await tx.query(
          sql`INSERT INTO payment_allocation (organization_id, receipt_id, deal_id, amount_minor, allocated_by) VALUES (${organizationId}, ${receipt.id}, ${dealId}, ${amountMinor}, ${actor.id}) ON CONFLICT (organization_id, receipt_id, deal_id) DO NOTHING`,
        );
        await tx.query(
          sql`UPDATE deal SET payment_status = CASE WHEN (SELECT COALESCE(SUM(amount_minor),0) FROM payment_allocation WHERE organization_id = ${organizationId} AND deal_id = ${dealId}) >= COALESCE((SELECT advance_minor FROM commercials c JOIN deal d ON d.commercials_id = c.id AND d.organization_id = c.organization_id WHERE d.organization_id = ${organizationId} AND d.id = ${dealId}), 0) THEN 'advance_confirmed' ELSE 'partial' END, updated_at = now() WHERE organization_id = ${organizationId} AND id = ${dealId}`,
        );
      } else if (invoiceId) {
        if (invoiceAllocation > 0n) {
          await tx.query(
            sql`INSERT INTO payment_allocation (organization_id, receipt_id, invoice_id, amount_minor, allocated_by) VALUES (${organizationId}, ${receipt.id}, ${invoiceId}, ${invoiceAllocation}, ${actor.id}) ON CONFLICT (organization_id, receipt_id, invoice_id) DO NOTHING`,
          );
          await refreshInvoiceStatus(tx, organizationId, invoiceId);
        } else {
          await tx.query(
            sql`INSERT INTO finance_payment_exception (organization_id,exception_type,status,reason,payload) VALUES (${organizationId},'payment_overpayment','open','Captured payment was not allocated because it exceeds the invoice balance or the invoice is unavailable.',${JSON.stringify({ invoiceId, amountMinor: amountMinor.toString(), outstandingMinor: invoiceOutstanding?.toString() ?? null, provider, eventId })}::jsonb)`,
          );
        }
      }
      if (providerPaymentId) {
        await tx.query(
          sql`UPDATE finance_payment SET status = 'captured', provider_payment_id = COALESCE(provider_payment_id, ${providerPaymentId}), updated_at = now() WHERE organization_id = ${organizationId} AND (provider_payment_id = ${providerPaymentId} OR reference_id = ${referenceId})`,
        );
      }
      const netAmount = amountMinor - feeMinor;
      await postSourceJournalTx(tx, {
        organizationId,
        postedBy: actor.id,
        entryDate: new Date().toISOString().slice(0, 10),
        sourceType: 'payment_receipt',
        sourceId: receipt.id,
        description: `Payment received via ${provider}${feeMinor > 0n ? ' (net of fees)' : ''}`,
        reason: 'Verified payment webhook',
        lines: [
          {
            accountKey: 'gateway-clearing',
            amountPaise: netAmount > 0n ? netAmount : amountMinor,
            side: 'debit',
          },
          ...(feeMinor > 0n
            ? [
                {
                  accountKey: 'gateway-fee-expense',
                  amountPaise: feeMinor,
                  side: 'debit' as const,
                },
              ]
            : []),
          {
            accountKey:
              cashClassification === 'receivable'
                ? 'accounts-receivable'
                : cashClassification === 'unapplied'
                  ? 'payment-suspense'
                  : 'advances-from-customers',
            amountPaise: amountMinor,
            side: 'credit',
          },
        ],
      });
      await tx.query(
        sql`UPDATE payment_webhook_event SET processed_at = now(), outcome = 'applied' WHERE id = ${inserted.id}`,
      );
    },
  );
  return { accepted: true, duplicate: false };
}

export const hyperswitchPaymentReadinessPort = {
  async evaluate(
    tx: Tx,
    organizationId: string,
    dealId: string,
    commercialsId: string | null,
  ) {
    const gateway = await tx.maybeOne<{ id: string }>(
      sql`SELECT id FROM finance_payment_gateway_config WHERE organization_id = ${organizationId} AND is_active = true LIMIT 1`,
    );
    if (!gateway) {
      const manual = await tx.maybeOne<{ paymentStatus: string }>(
        sql`SELECT payment_status AS "paymentStatus" FROM deal WHERE organization_id = ${organizationId} AND id = ${dealId}`,
      );
      const satisfied =
        manual?.paymentStatus === 'advance_confirmed' || manual?.paymentStatus === 'paid';
      return {
        satisfied,
        description: satisfied
          ? 'Advance confirmed by Finance.'
          : 'No gateway is configured; confirm the payment manually through the existing Finance workflow.',
        expectedAdvanceMinor: null,
        netVerifiedMinor: null,
      };
    }
    if (!commercialsId)
      return {
        satisfied: true,
        description: 'No advance is configured for this deal.',
        expectedAdvanceMinor: 0n,
        netVerifiedMinor: 0n,
      };
    const expected = await tx.one<{ amount: string }>(
      sql`SELECT advance_minor::text AS amount FROM commercials WHERE organization_id = ${organizationId} AND id = ${commercialsId}`,
    );
    const net = await findVerifiedReceiptTotal(tx, organizationId, dealId);
    const required = BigInt(expected.amount);
    return {
      satisfied: net >= required,
      description:
        net >= required
          ? 'Verified gateway receipts satisfy the advance.'
          : `Verified receipts ${net} of ${required} minor units.`,
      expectedAdvanceMinor: required,
      netVerifiedMinor: net,
    };
  },
};
