/**
 * Sales v1.1 — Google Business Profile call-tracking adapter via Exotel
 * (R1 plan step 1.10).
 *
 * Exotel posts call lifecycle events (`StartTime`, `AnsweredTime`,
 * `EndTime`, `Status`, optional `RecordingUrl`) as form-urlencoded
 * webhooks. One tracked business number per GBP connector, keyed off
 * `sales_connector.external_account_id`. The flow per `Status`:
 *
 *   answered  → look up the caller as a contact.
 *                 - match + active lead  → append `call.recorded` activity;
 *                 - no match             → create a new lead and promote
 *                   it straight to `claimed` by the agent who answered
 *                   (bypasses the bid pool because the agent is already
 *                    on the phone).
 *
 *   missed / no-answer → create a new lead via `ingest()` with
 *                        `isMissedCall: true` in the mapped fields; the
 *                        standard intake pipeline puts it into the bid
 *                        pool with a 10-minute callback SLA.
 *
 * Signature verification follows the Exotel-documented HMAC-SHA1 over
 * the request URL concatenated with the sorted form parameters. The
 * secret is per-connector (stored in `config.webhookSecret`).
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Principal } from '@tapcrm/contracts';

import { ApplicationError } from '../../../../errors.js';
import { createJobContext, type RequestContext } from '../../../../platform/dal/context.js';
import { db, platformDb } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import { insertActivity } from '../../leads/repository.js';
import { ingest } from '../../intake/service.js';
import type { IntakePayload } from '../../intake/types.js';

export const GBP_SIGNATURE_HEADER = 'x-exotel-signature';
export const GBP_ADAPTER_ERROR_CODES = {
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  UNKNOWN_CONNECTOR: 'UNKNOWN_CONNECTOR',
  CONNECTOR_SECRET_MISSING: 'GBP_SECRET_MISSING',
  MALFORMED_BODY: 'MALFORMED_WEBHOOK_BODY',
} as const;

export class GbpSignatureInvalidError extends ApplicationError {
  constructor() {
    super('Webhook signature failed verification', 401, GBP_ADAPTER_ERROR_CODES.SIGNATURE_INVALID);
    this.name = 'GbpSignatureInvalidError';
  }
}
export class GbpConnectorUnknownError extends ApplicationError {
  constructor(trackedNumber: string) {
    super(`No GBP connector configured for tracked number ${trackedNumber}`, 404, GBP_ADAPTER_ERROR_CODES.UNKNOWN_CONNECTOR);
    this.name = 'GbpConnectorUnknownError';
  }
}
export class GbpConnectorSecretMissingError extends ApplicationError {
  constructor() {
    super('GBP connector is missing its webhook secret', 503, GBP_ADAPTER_ERROR_CODES.CONNECTOR_SECRET_MISSING);
    this.name = 'GbpConnectorSecretMissingError';
  }
}
export class GbpMalformedBodyError extends ApplicationError {
  constructor(details?: unknown) {
    super('Request body is not valid form-urlencoded', 400, GBP_ADAPTER_ERROR_CODES.MALFORMED_BODY, details);
    this.name = 'GbpMalformedBodyError';
  }
}

/**
 * Timing-safe HMAC-SHA1(URL + sorted(k+v)) base64 verifier. The
 * algorithm mirrors Twilio's X-Twilio-Signature, which is also how
 * Exotel's documented signature works today.
 */
export function verifyExotelSignature(
  secret: string,
  url: string,
  params: Readonly<Record<string, string>>,
  signatureHeader: string | undefined,
): boolean {
  if (!secret || !signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  const serialized = sortedKeys.map((k) => k + (params[k] ?? '')).join('');
  const expected = createHmac('sha1', secret).update(url + serialized).digest('base64');
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signatureHeader, 'utf8'));
}

const exotelBodySchema = z.object({
  CallSid: z.string().trim().min(1),
  From: z.string().trim().min(1),
  To: z.string().trim().min(1),
  Status: z.string().trim().min(1),
  StartTime: z.string().trim().optional(),
  AnsweredTime: z.string().trim().optional(),
  EndTime: z.string().trim().optional(),
  AgentID: z.string().trim().optional(),
  RecordingUrl: z.string().trim().url().optional(),
  CallerName: z.string().trim().optional(),
}).passthrough();

export type ExotelBody = z.infer<typeof exotelBodySchema>;

export type GbpOutcome = 'activity_appended' | 'lead_claimed' | 'lead_bid_pool' | 'ignored';

export interface IngestGbpResult {
  readonly outcome: GbpOutcome;
  readonly leadId: string | null;
  readonly submissionId: string | null;
  readonly reason: string;
}

interface GbpConnectorRow {
  readonly connectorId: string;
  readonly organizationId: string;
  readonly status: string;
  readonly webhookSecret: string | null;
  readonly defaultAgentId: string | null;
}

async function findGbpConnectorByNumber(trackedNumber: string): Promise<GbpConnectorRow | null> {
  const row = await platformDb.maybeOne<{
    connectorId: string;
    organizationId: string;
    status: string;
    webhookSecret: string | null;
    defaultAgentId: string | null;
  }>(
    'webhook-dispatch',
    'resolve GBP connector by tracked business number',
    sql`
      SELECT id                                      AS "connectorId",
             organization_id                         AS "organizationId",
             status,
             (config->>'webhookSecret')              AS "webhookSecret",
             (config->>'defaultAgentId')             AS "defaultAgentId"
        FROM sales_connector
       WHERE kind                 = 'gbp'
         AND external_account_id  = ${trackedNumber}
    `,
  );
  return row;
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
    jobName: 'sales.webhook.gbp',
    runId: randomUUID(),
  });
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveAgentId(
  ctx: RequestContext,
  agentIdHeader: string | undefined,
  defaultAgentId: string | null,
): Promise<string | null> {
  const candidate = (agentIdHeader && UUID_RE.test(agentIdHeader) ? agentIdHeader : defaultAgentId);
  if (!candidate) return null;
  const row = await db.maybeOne<{ id: string }>(
    ctx,
    sql`SELECT id FROM app_user WHERE id = ${candidate} AND status = 'active'`,
  );
  return row?.id ?? null;
}

async function findActiveLeadForPhone(
  ctx: RequestContext,
  phoneE164: string,
): Promise<{ leadId: string; contactId: string } | null> {
  if (!phoneE164) return null;
  return db.maybeOne<{ leadId: string; contactId: string }>(
    ctx,
    sql`
      SELECT l.id         AS "leadId",
             c.id         AS "contactId"
        FROM lead l
        JOIN contact c ON c.organization_id = l.organization_id AND c.id = l.contact_id
       WHERE l.organization_id = ${ctx.organizationId}
         AND c.primary_phone   = ${phoneE164}
         AND l.lead_outcome    = 'active'
       ORDER BY l.created_at DESC
       LIMIT 1
    `,
  );
}

function buildIntakePayload(
  connectorId: string,
  body: ExotelBody,
  rawBody: Buffer,
  isMissedCall: boolean,
): IntakePayload {
  const fromPhone = normalizePhone(body.From);
  const mappedFields: Record<string, unknown> = {
    phoneRaw: fromPhone || null,
    contactName: body.CallerName ?? null,
    message: `GBP call ${body.Status.toLowerCase()}`,
    gbpCallSid: body.CallSid,
    isMissedCall,
  };
  if (body.RecordingUrl) mappedFields['recordingUrl'] = body.RecordingUrl;
  return {
    connectorId,
    externalLeadId: body.CallSid,
    rawPayload: rawBody,
    mappedFields: mappedFields,
    ...(body.StartTime ? { providerSubmittedAt: new Date(body.StartTime) } : {}),
  };
}

async function promoteLeadToClaimed(
  ctx: RequestContext,
  leadId: string,
  agentId: string,
  now: Date,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    await tx.query(sql`
      UPDATE lead
         SET bid_state                = 'claimed',
             owner_id                 = ${agentId},
             current_holder_id        = ${agentId},
             originating_agent_id     = COALESCE(originating_agent_id, ${agentId}),
             routing_status           = 'assigned',
             status                   = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
             claimed_at               = ${now},
             sla_first_contact_due_at = ${now},
             updated_at               = ${now}
       WHERE organization_id = ${ctx.organizationId}
         AND id              = ${leadId}
    `);
  });
}

async function appendCallActivity(
  ctx: RequestContext,
  leadId: string,
  body: ExotelBody,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    await insertActivity(tx, ctx.organizationId, leadId, 'call.recorded', null, {
      source: 'gbp.exotel',
      callSid: body.CallSid,
      status: body.Status.toLowerCase(),
      startTime: body.StartTime ?? null,
      answeredTime: body.AnsweredTime ?? null,
      endTime: body.EndTime ?? null,
      recordingUrl: body.RecordingUrl ?? null,
    });
  });
}

export interface IngestExotelCallInput {
  readonly rawBody: Buffer;
  readonly params: Readonly<Record<string, string>>;
  readonly url: string;
  readonly signatureHeader: string | undefined;
}

export async function ingestExotelCall(input: IngestExotelCallInput): Promise<IngestGbpResult> {
  const parsed = exotelBodySchema.safeParse(input.params);
  if (!parsed.success) {
    throw new GbpMalformedBodyError({
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  const body = parsed.data;
  const trackedNumber = normalizePhone(body.To);
  if (!trackedNumber) throw new GbpMalformedBodyError({ message: 'To number is empty' });

  const connector = await findGbpConnectorByNumber(trackedNumber);
  if (!connector) throw new GbpConnectorUnknownError(trackedNumber);
  if (!connector.webhookSecret) throw new GbpConnectorSecretMissingError();
  if (!verifyExotelSignature(connector.webhookSecret, input.url, input.params, input.signatureHeader)) {
    throw new GbpSignatureInvalidError();
  }
  if (connector.status !== 'active') {
    return { outcome: 'ignored', leadId: null, submissionId: null, reason: `connector_${connector.status}` };
  }

  const ctx = webhookCtxFor(connector.organizationId);
  const status = body.Status.toLowerCase();
  const now = new Date();

  if (status === 'answered') {
    const fromPhone = normalizePhone(body.From);
    const existing = await findActiveLeadForPhone(ctx, fromPhone);
    if (existing) {
      await appendCallActivity(ctx, existing.leadId, body);
      return {
        outcome: 'activity_appended',
        leadId: existing.leadId,
        submissionId: null,
        reason: 'known_contact',
      };
    }
    const result = await ingest(ctx, buildIntakePayload(connector.connectorId, body, input.rawBody, false));
    const agentId = await resolveAgentId(ctx, body.AgentID, connector.defaultAgentId);
    if (result.leadId && agentId) {
      await promoteLeadToClaimed(ctx, result.leadId, agentId, now);
      await appendCallActivity(ctx, result.leadId, body);
      return {
        outcome: 'lead_claimed',
        leadId: result.leadId,
        submissionId: result.submissionId,
        reason: 'answered_new_contact',
      };
    }
    return {
      outcome: 'lead_bid_pool',
      leadId: result.leadId ?? null,
      submissionId: result.submissionId,
      reason: result.leadId ? 'answered_but_no_agent' : (result.outcome ?? 'answered_no_lead'),
    };
  }

  if (status === 'missed' || status === 'no-answer' || status === 'no_answer') {
    const result = await ingest(ctx, buildIntakePayload(connector.connectorId, body, input.rawBody, true));
    return {
      outcome: 'lead_bid_pool',
      leadId: result.leadId ?? null,
      submissionId: result.submissionId,
      reason: `missed_call:${status}`,
    };
  }

  return { outcome: 'ignored', leadId: null, submissionId: null, reason: `unsupported_status:${status}` };
}
