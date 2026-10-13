/**
 * Sales v1.1 — website intake adapter (R1 plan step 1.6).
 *
 * Shape of the webhook body (field names mirror the canonical
 * IntakeMappedFields shape so the adapter's job is "verify + hand off"):
 *
 *   {
 *     submissionUUID: "<idempotency key>",
 *     contactName?:   string,
 *     phoneRaw?:      string,
 *     emailRaw?:      string,
 *     companyName?:   string,
 *     serviceRequested?: string,
 *     location?:      string,
 *     budgetBracket?: string,
 *     timeline?:      string,
 *     languagePreference?: string,
 *     message?:       string,
 *     utm?:           { source, medium, campaign, ... }
 *   }
 *
 * Flow:
 *   1. Cross-tenant lookup (platformDb) → connector row with orgId,
 *      status, kind and `config.webhookSecret`.
 *   2. HMAC-SHA256(rawBody, secret), timing-safe equal to the
 *      `X-Tapcrm-Intake-Signature` hex header.
 *   3. JSON-parse + zod validate the body; `submissionUUID` is the
 *      canonical `external_lead_id` (R-INT-02 idempotency key).
 *   4. Build tenant RequestContext and call `ingest()`; the intake
 *      service owns dedupe, routing and lead creation.
 *   5. Return `{ submissionId, outcome }` to the route layer, which
 *      serialises a 202 response.
 *
 * The webhook secret currently lives in `sales_connector.config.webhookSecret`.
 * `secret_ref` on the connector table is reserved for the pointer-into-KMS
 * form that lands with the secret-store wiring; moving the secret is a
 * drop-in change behind this adapter.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext, type RequestContext } from '../../../../platform/dal/context.js';
import { platformDb } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import { ApplicationError } from '../../../../errors.js';
import { ingest } from '../../intake/service.js';
import type { IntakePayload } from '../../intake/types.js';

export const WEBSITE_INTAKE_SIGNATURE_HEADER = 'x-tapcrm-intake-signature';

export const WEBSITE_ADAPTER_ERROR_CODES = {
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  UNKNOWN_CONNECTOR: 'UNKNOWN_CONNECTOR',
  CONNECTOR_INACTIVE: 'CONNECTOR_INACTIVE',
  MISSING_SECRET: 'WEBHOOK_SECRET_MISSING',
  MALFORMED_BODY: 'MALFORMED_WEBHOOK_BODY',
} as const;

export class WebsiteSignatureInvalidError extends ApplicationError {
  constructor() {
    super('Webhook signature failed verification', 401, WEBSITE_ADAPTER_ERROR_CODES.SIGNATURE_INVALID);
    this.name = 'WebsiteSignatureInvalidError';
  }
}
export class WebsiteConnectorUnknownError extends ApplicationError {
  constructor(connectorId: string) {
    super(`Website connector not found: ${connectorId}`, 404, WEBSITE_ADAPTER_ERROR_CODES.UNKNOWN_CONNECTOR);
    this.name = 'WebsiteConnectorUnknownError';
  }
}
export class WebsiteConnectorInactiveError extends ApplicationError {
  constructor(status: string) {
    super(`Website connector is ${status}, not active`, 409, WEBSITE_ADAPTER_ERROR_CODES.CONNECTOR_INACTIVE, { status });
    this.name = 'WebsiteConnectorInactiveError';
  }
}
export class WebsiteConnectorMissingSecretError extends ApplicationError {
  constructor() {
    super('Website connector is missing its webhook secret', 503, WEBSITE_ADAPTER_ERROR_CODES.MISSING_SECRET);
    this.name = 'WebsiteConnectorMissingSecretError';
  }
}
export class WebsiteMalformedBodyError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 400, WEBSITE_ADAPTER_ERROR_CODES.MALFORMED_BODY, details);
    this.name = 'WebsiteMalformedBodyError';
  }
}

export const websiteBodySchema = z.object({
  submissionUUID: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional(),
  phoneRaw: z.string().trim().max(50).optional(),
  emailRaw: z.string().trim().max(320).optional(),
  companyName: z.string().trim().max(200).optional(),
  serviceRequested: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  budgetBracket: z.string().trim().max(100).optional(),
  timeline: z.string().trim().max(100).optional(),
  languagePreference: z.string().trim().max(50).optional(),
  message: z.string().trim().max(4000).optional(),
  utm: z.record(z.string().max(500)).optional(),
  mappingVersion: z.string().trim().max(50).optional(),
}).passthrough();

export type WebsiteBody = z.infer<typeof websiteBodySchema>;

export interface WebsiteConnectorRow {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: string;
  readonly status: string;
  readonly webhookSecret: string | null;
}

/**
 * Timing-safe HMAC verifier. The two hex strings are compared only once
 * they are the same length, so the comparator never leaks a prefix-match.
 */
export function verifyHmacSignature(secret: string, rawBody: Buffer, signatureHex: string | null | undefined): boolean {
  if (!secret || !signatureHex) return false;
  const trimmed = signatureHex.trim().toLowerCase();
  if (trimmed.length === 0 || !/^[0-9a-f]+$/.test(trimmed)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== trimmed.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(trimmed, 'utf8'));
}

/** Platform-scoped connector lookup. Audited by platformDb's operation label. */
async function findWebsiteConnector(connectorId: string): Promise<WebsiteConnectorRow | null> {
  return platformDb.maybeOne<WebsiteConnectorRow>(
    'webhook-dispatch',
    'resolve website connector for webhook authentication',
    sql`
      SELECT id,
             organization_id      AS "organizationId",
             kind,
             status,
             (config->>'webhookSecret') AS "webhookSecret"
        FROM sales_connector
       WHERE id = ${connectorId}
    `,
  );
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
    jobName: 'sales.webhook.website',
    runId: randomUUID(),
  });
}

export interface WebsiteIngestResult {
  readonly submissionId: string;
  readonly outcome: string;
  readonly leadId: string | undefined;
}

export async function ingestWebsiteSubmission(
  connectorId: string,
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
): Promise<WebsiteIngestResult> {
  const connector = await findWebsiteConnector(connectorId);
  if (!connector) throw new WebsiteConnectorUnknownError(connectorId);
  if (connector.kind !== 'website') throw new WebsiteConnectorUnknownError(connectorId);
  if (!connector.webhookSecret) throw new WebsiteConnectorMissingSecretError();
  if (!verifyHmacSignature(connector.webhookSecret, rawBody, signatureHeader)) {
    throw new WebsiteSignatureInvalidError();
  }
  if (connector.status !== 'active') {
    throw new WebsiteConnectorInactiveError(connector.status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch (_err) {
    throw new WebsiteMalformedBodyError('Request body is not valid JSON');
  }
  const result = websiteBodySchema.safeParse(parsed);
  if (!result.success) {
    throw new WebsiteMalformedBodyError('Request body failed schema validation', {
      issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }

  const body = result.data;
  const mappedFields: Record<string, unknown> = {
    contactName: body.contactName ?? null,
    phoneRaw: body.phoneRaw ?? null,
    emailRaw: body.emailRaw ?? null,
    companyName: body.companyName ?? null,
    serviceRequested: body.serviceRequested ?? null,
    location: body.location ?? null,
    budgetBracket: body.budgetBracket ?? null,
    timeline: body.timeline ?? null,
    languagePreference: body.languagePreference ?? null,
    message: body.message ?? null,
  };
  if (body.utm !== undefined) mappedFields['utm'] = body.utm;
  const payload: IntakePayload = {
    connectorId: connector.id,
    externalLeadId: body.submissionUUID,
    rawPayload: rawBody,
    mappedFields: mappedFields,
    ...(body.mappingVersion !== undefined ? { mappingVersion: body.mappingVersion } : {}),
  };

  const ingestResult = await ingest(webhookCtxFor(connector.organizationId), payload);
  return {
    submissionId: ingestResult.submissionId,
    outcome: ingestResult.outcome,
    leadId: ingestResult.leadId,
  };
}
