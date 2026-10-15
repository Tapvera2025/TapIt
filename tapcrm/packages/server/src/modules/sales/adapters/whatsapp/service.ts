/**
 * Sales v1.1 — WhatsApp webhook orchestration (R1 plan step 1.9).
 *
 * The route layer gives us the raw body + headers + provider; this
 * service picks the right driver, verifies the signature, parses the
 * payload, classifies each event, and dispatches to `ingest()` for
 * genuine inbound enquiries. Status receipts and empty messages are
 * acknowledged but never create a lead.
 *
 * One-word greetings are treated as enquiries at R1: the plan's
 * "promote on second message" refinement needs a WhatsApp-conversation
 * table that doesn't exist yet; flagging that as a follow-up.
 */

import { randomUUID } from 'node:crypto';
import type { Principal } from '@tapcrm/contracts';
import { ApplicationError } from '../../../../errors.js';
import { createJobContext, type RequestContext } from '../../../../platform/dal/context.js';
import { platformDb } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import { ingest } from '../../intake/service.js';
import type { IntakeMappedFields, IntakePayload } from '../../intake/types.js';
import { classifyInbound, type ClassifierVerdict } from './classifier.js';
import {
  WHATSAPP_PROVIDERS,
  isWhatsAppProvider,
  type ConnectorLike,
  type InboundEvent,
  type WebhookRequest,
  type WhatsAppDriver,
  type WhatsAppProvider,
} from './driver.js';
import { metaCloudDriver } from './drivers/meta-cloud.js';
import { interaktDriver } from './drivers/interakt.js';
import { gupshupDriver } from './drivers/gupshup.js';
import { twilioDriver } from './drivers/twilio.js';

export const WHATSAPP_ADAPTER_ERROR_CODES = {
  UNKNOWN_PROVIDER: 'UNKNOWN_WHATSAPP_PROVIDER',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  UNKNOWN_CONNECTOR: 'UNKNOWN_CONNECTOR',
  CONNECTOR_SECRET_MISSING: 'WHATSAPP_SECRET_MISSING',
  MALFORMED_BODY: 'MALFORMED_WEBHOOK_BODY',
} as const;

export class WhatsAppUnknownProviderError extends ApplicationError {
  constructor(provider: string) {
    super(`Unknown WhatsApp provider: ${provider}`, 404, WHATSAPP_ADAPTER_ERROR_CODES.UNKNOWN_PROVIDER, {
      supported: WHATSAPP_PROVIDERS,
    });
    this.name = 'WhatsAppUnknownProviderError';
  }
}
export class WhatsAppSignatureInvalidError extends ApplicationError {
  constructor() {
    super('Webhook signature failed verification', 401, WHATSAPP_ADAPTER_ERROR_CODES.SIGNATURE_INVALID);
    this.name = 'WhatsAppSignatureInvalidError';
  }
}
export class WhatsAppConnectorUnknownError extends ApplicationError {
  constructor(providerAccountId: string) {
    super(`No WhatsApp connector configured for provider account ${providerAccountId}`, 404, WHATSAPP_ADAPTER_ERROR_CODES.UNKNOWN_CONNECTOR);
    this.name = 'WhatsAppConnectorUnknownError';
  }
}
export class WhatsAppSecretMissingError extends ApplicationError {
  constructor() {
    super('WhatsApp connector is missing its webhook secret', 503, WHATSAPP_ADAPTER_ERROR_CODES.CONNECTOR_SECRET_MISSING);
    this.name = 'WhatsAppSecretMissingError';
  }
}
export class WhatsAppMalformedBodyError extends ApplicationError {
  constructor(details?: unknown) {
    super('Request body is not valid JSON', 400, WHATSAPP_ADAPTER_ERROR_CODES.MALFORMED_BODY, details);
    this.name = 'WhatsAppMalformedBodyError';
  }
}

export const DRIVERS: Readonly<Record<WhatsAppProvider, WhatsAppDriver>> = {
  meta_cloud: metaCloudDriver,
  interakt: interaktDriver,
  gupshup: gupshupDriver,
  twilio: twilioDriver,
};

export function driverFor(provider: string): WhatsAppDriver {
  if (!isWhatsAppProvider(provider)) throw new WhatsAppUnknownProviderError(provider);
  return DRIVERS[provider];
}

interface WhatsAppConnectorRow {
  readonly connectorId: string;
  readonly organizationId: string;
  readonly status: string;
  readonly config: Record<string, unknown>;
}

async function findConnectorsByAccountIds(providerAccountIds: readonly string[]): Promise<Map<string, WhatsAppConnectorRow>> {
  if (providerAccountIds.length === 0) return new Map();
  const rows = await platformDb.query<{
    connectorId: string;
    organizationId: string;
    status: string;
    externalAccountId: string;
    config: Record<string, unknown>;
  }>(
    'webhook-dispatch',
    'resolve WhatsApp connector(s) for incoming webhook',
    sql`
      SELECT id                  AS "connectorId",
             organization_id     AS "organizationId",
             status,
             external_account_id AS "externalAccountId",
             config
        FROM sales_connector
       WHERE kind = 'whatsapp'
         AND external_account_id = ANY(${providerAccountIds}::text[])
    `,
  );
  const byAccountId = new Map<string, WhatsAppConnectorRow>();
  for (const row of rows) {
    byAccountId.set(row.externalAccountId, {
      connectorId: row.connectorId,
      organizationId: row.organizationId,
      status: row.status,
      config: row.config ?? {},
    });
  }
  return byAccountId;
}

function webhookCtxFor(organizationId: string): RequestContext {
  const principal: Principal = {
    id: '00000000-0000-7000-8000-000000000000',
    organizationId,
    sessionVersion: 0,
    accountType: 'service',
    allowedActions: [],
    allowedResources: [],
    expiresAt: new Date(Date.now() + 60_000),
  };
  return createJobContext({
    organizationId,
    principal,
    jobName: 'sales.webhook.whatsapp',
    runId: randomUUID(),
  });
}

function mappedFieldsFromEvent(event: Extract<InboundEvent, { type: 'message' }>): IntakeMappedFields {
  const fields: Record<string, unknown> = {
    phoneRaw: event.fromPhone || null,
    message: event.text ?? null,
  };
  if (event.kind !== 'text') fields['whatsappMessageKind'] = event.kind;
  return fields;
}

export interface IngestWhatsAppResult {
  readonly accepted: number;
  readonly skipped: number;
  readonly verdicts: ReadonlyArray<{ messageId: string; verdict: ClassifierVerdict }>;
}

export async function ingestWhatsAppWebhook(
  provider: string,
  req: WebhookRequest,
): Promise<IngestWhatsAppResult> {
  const driver = driverFor(provider);

  let parsedBody: unknown;
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    parsedBody = Object.fromEntries(new URLSearchParams(req.rawBody.toString('utf8')));
  } else {
    try {
      parsedBody = JSON.parse(req.rawBody.toString('utf8'));
    } catch (_err) {
      throw new WhatsAppMalformedBodyError();
    }
  }

  const events = driver.parseInbound(parsedBody);
  if (events.length === 0) return { accepted: 0, skipped: 0, verdicts: [] };

  const providerAccountIds = [...new Set(events.map((e) => e.providerAccountId).filter(Boolean))];
  const connectors = await findConnectorsByAccountIds(providerAccountIds);
  // All events in one webhook share a provider; verify signature once
  // using the first matched connector's secret. If no connector matches,
  // we still 401 (a stranger shouldn't learn whether the number exists).
  const firstMatch = providerAccountIds.map((id) => connectors.get(id)).find((c) => c !== undefined);
  const secret =
    firstMatch !== undefined && typeof firstMatch.config['webhookSecret'] === 'string'
      ? (firstMatch.config['webhookSecret'])
      : null;
  if (secret === null) throw new WhatsAppSecretMissingError();
  if (!driver.verifyWebhook(req, secret)) throw new WhatsAppSignatureInvalidError();

  const verdicts: Array<{ messageId: string; verdict: ClassifierVerdict }> = [];
  let accepted = 0;
  let skipped = 0;

  for (const event of events) {
    const classification = classifyInbound(event);
    verdicts.push({ messageId: event.messageId, verdict: classification.verdict });
    if (classification.verdict === 'status_receipt' || classification.verdict === 'empty_message') {
      skipped++;
      continue;
    }
    const connector = connectors.get(event.providerAccountId);
    if (!connector || connector.status !== 'active') {
      skipped++;
      continue;
    }
    if (event.type !== 'message') {
      skipped++;
      continue;
    }
    const ctx = webhookCtxFor(connector.organizationId);
    const payload: IntakePayload = {
      connectorId: connector.connectorId,
      externalLeadId: event.messageId,
      rawPayload: req.rawBody,
      mappedFields: mappedFieldsFromEvent(event),
      ...(event.sentAt !== null ? { providerSubmittedAt: event.sentAt } : {}),
    };
    await ingest(ctx, payload);
    accepted++;
  }

  return { accepted, skipped, verdicts };
}

export type { ConnectorLike };
