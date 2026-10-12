/**
 * Sales v1.1 — Meta Lead Ads webhook adapter (R1 plan step 1.7).
 *
 * Meta posts a single URL for every tenant. The notification carries a
 * `page_id` per `entry[]`; the connector lookup goes from page_id to the
 * owning organization, honoured by `sales_connector.external_account_id`.
 *
 * Signature: HMAC-SHA256(rawBody, META_APP_SECRET) hex, in the
 * `X-Hub-Signature-256: sha256=<hex>` header. The secret is deployment-
 * scoped — Meta app secrets are not per-connector.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { ApplicationError } from '../../../../errors.js';
import { platformDb } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import { metaFetchLeadJob } from '../../intake/jobs.js';

export const META_SIGNATURE_HEADER = 'x-hub-signature-256';

export const META_ADAPTER_ERROR_CODES = {
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  MALFORMED_NOTIFICATION: 'MALFORMED_META_NOTIFICATION',
  CONNECTOR_SECRET_MISSING: 'META_APP_SECRET_MISSING',
} as const;

export class MetaSignatureInvalidError extends ApplicationError {
  constructor() {
    super('Webhook signature failed verification', 401, META_ADAPTER_ERROR_CODES.SIGNATURE_INVALID);
    this.name = 'MetaSignatureInvalidError';
  }
}
export class MetaAppSecretMissingError extends ApplicationError {
  constructor() {
    super('META_APP_SECRET is not configured', 503, META_ADAPTER_ERROR_CODES.CONNECTOR_SECRET_MISSING);
    this.name = 'MetaAppSecretMissingError';
  }
}
export class MetaMalformedNotificationError extends ApplicationError {
  constructor(details: unknown) {
    super('Meta webhook notification failed schema validation', 400, META_ADAPTER_ERROR_CODES.MALFORMED_NOTIFICATION, details);
    this.name = 'MetaMalformedNotificationError';
  }
}

/**
 * Timing-safe verifier for the `sha256=<hex>` header form. The leading
 * `sha256=` prefix is required (otherwise a caller could pass the raw
 * hex and bypass the algorithm selector) and the hex comparison runs
 * only when the lengths match.
 */
export function verifyMetaSignature(appSecret: string, rawBody: Buffer, signatureHeader: string | null | undefined): boolean {
  if (!appSecret || !signatureHeader) return false;
  const [algo, hex] = signatureHeader.trim().split('=', 2);
  if (algo !== 'sha256' || !hex || !/^[0-9a-f]+$/i.test(hex)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const lowered = hex.toLowerCase();
  if (expected.length !== lowered.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(lowered, 'utf8'));
}

const leadgenValueSchema = z.object({
  leadgen_id: z.string().trim().min(1),
  form_id: z.string().trim().optional(),
  page_id: z.string().trim().min(1),
  ad_id: z.string().trim().optional(),
  adgroup_id: z.string().trim().optional(),
  created_time: z.union([z.number(), z.string()]).optional(),
});

const metaNotificationSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        id: z.string(),
        time: z.number().optional(),
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z.unknown(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});

export interface ExtractedLeadgenEvent {
  readonly pageId: string;
  readonly leadgenId: string;
  readonly formId: string | null;
  readonly createdTime: string | null;
}

export function extractLeadgenEvents(parsedBody: unknown): ExtractedLeadgenEvent[] {
  const parsed = metaNotificationSchema.safeParse(parsedBody);
  if (!parsed.success) {
    throw new MetaMalformedNotificationError({
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  const events: ExtractedLeadgenEvent[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'leadgen') continue;
      const value = leadgenValueSchema.safeParse(change.value);
      if (!value.success) continue;
      events.push({
        pageId: value.data.page_id,
        leadgenId: value.data.leadgen_id,
        formId: value.data.form_id ?? null,
        createdTime:
          typeof value.data.created_time === 'number'
            ? new Date(value.data.created_time * 1000).toISOString()
            : (value.data.created_time ?? null),
      });
    }
  }
  return events;
}

export interface MetaConnectorMatch {
  readonly connectorId: string;
  readonly organizationId: string;
  readonly status: string;
}

export async function findMetaConnectorsByPage(pageIds: readonly string[]): Promise<Map<string, MetaConnectorMatch>> {
  if (pageIds.length === 0) return new Map();
  const rows = await platformDb.query<{
    connectorId: string;
    organizationId: string;
    status: string;
    externalAccountId: string;
  }>(
    'webhook-dispatch',
    'resolve Meta connectors for incoming leadgen notification',
    sql`
      SELECT id              AS "connectorId",
             organization_id AS "organizationId",
             status,
             external_account_id AS "externalAccountId"
        FROM sales_connector
       WHERE kind                 = 'meta'
         AND external_account_id  = ANY(${pageIds as unknown as string[]}::text[])
    `,
  );
  const map = new Map<string, MetaConnectorMatch>();
  for (const row of rows) {
    map.set(row.externalAccountId, {
      connectorId: row.connectorId,
      organizationId: row.organizationId,
      status: row.status,
    });
  }
  return map;
}

export interface IngestMetaWebhookInput {
  readonly rawBody: Buffer;
  readonly signatureHeader: string | null | undefined;
  readonly appSecret: string | undefined;
}

export interface IngestMetaWebhookResult {
  readonly accepted: number;
  readonly skipped: number;
  readonly reasons: readonly string[];
}

export async function ingestMetaWebhook(input: IngestMetaWebhookInput): Promise<IngestMetaWebhookResult> {
  if (!input.appSecret) throw new MetaAppSecretMissingError();
  if (!verifyMetaSignature(input.appSecret, input.rawBody, input.signatureHeader)) {
    throw new MetaSignatureInvalidError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody.toString('utf8'));
  } catch (_err) {
    throw new MetaMalformedNotificationError({ message: 'body is not valid JSON' });
  }
  const events = extractLeadgenEvents(parsed);
  if (events.length === 0) {
    return { accepted: 0, skipped: 0, reasons: ['no_leadgen_changes'] };
  }

  const connectorsByPage = await findMetaConnectorsByPage([...new Set(events.map((e) => e.pageId))]);
  const reasons: string[] = [];
  let accepted = 0;
  let skipped = 0;
  for (const event of events) {
    const connector = connectorsByPage.get(event.pageId);
    if (!connector) {
      skipped++;
      reasons.push(`unknown_page:${event.pageId}`);
      continue;
    }
    if (connector.status === 'disconnected' || connector.status === 'paused') {
      skipped++;
      reasons.push(`connector_${connector.status}:${connector.connectorId}`);
      continue;
    }
    await metaFetchLeadJob.enqueue({
      organizationId: connector.organizationId,
      key: event.leadgenId,
      payload: {
        connectorId: connector.connectorId,
        leadgenId: event.leadgenId,
        formId: event.formId,
        createdTime: event.createdTime,
      },
    });
    accepted++;
  }
  return { accepted, skipped, reasons };
}
