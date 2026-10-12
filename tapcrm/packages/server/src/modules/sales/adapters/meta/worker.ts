/**
 * Sales v1.1 — Meta adapter worker glue (R1 plan step 1.7).
 *
 * The BullMQ job handlers delegate here so the queue registration file
 * stays thin and the business logic is testable without a running
 * worker. Two entry points:
 *
 *   runMetaFetchLeadJob      — one leadgen_id → Graph fetch → ingest
 *   runMetaReconcileForOrg   — per-tick sweep across the org's connectors
 *
 * The real `fetch` is injected via module-level setters so tests can
 * swap it for a stub. Default production fetcher is `globalThis.fetch`.
 */

import type { RequestContext } from '../../../../platform/dal/context.js';
import { db } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import { loadConfig } from '../../../../config.js';
import { ingest } from '../../intake/service.js';
import { metaFetchLeadJob, type MetaFetchLeadPayload } from '../../intake/jobs.js';
import {
  MetaFetchFailedError,
  MetaReconnectRequiredError,
  fetchMetaLead,
  normalizeFieldData,
  type MetaFetcher,
} from './retrieval.js';
import {
  fetchesMissingFromSubmissions,
  findExistingSubmissionKeys,
  listRecentLeadsForPage,
} from './reconcile.js';

type GlobalFetch = (input: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

const defaultFetcher: MetaFetcher = async (input, init) => {
  const nativeFetch = (globalThis as { fetch?: GlobalFetch }).fetch;
  if (!nativeFetch) throw new Error('global fetch is not available in this runtime');
  const response = await nativeFetch(input, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    json: () => response.json(),
  };
};

let fetcher: MetaFetcher = defaultFetcher;

/** Test seam. Call `setMetaFetcher(() => defaultFetcher)` to restore. */
export function setMetaFetcher(custom: MetaFetcher): void {
  fetcher = custom;
}

export type FetchLeadOutcome = 'ingested' | 'reconnect_required' | 'connector_missing' | 'fetch_failed';

interface MetaConnectorRow {
  readonly id: string;
  readonly status: string;
  readonly config: Record<string, unknown>;
}

async function loadConnector(ctx: RequestContext, connectorId: string): Promise<MetaConnectorRow | null> {
  return db.maybeOne<MetaConnectorRow>(
    ctx,
    sql`SELECT id, status, config FROM sales_connector WHERE id = ${connectorId} AND kind = 'meta'`,
  );
}

async function markConnectorReconnectRequired(ctx: RequestContext, connectorId: string, httpStatus: number): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    await tx.query(sql`
      UPDATE sales_connector
         SET status        = 'reconnect_required',
             current_error = ${`graph_api_${httpStatus}`},
             updated_at    = now()
       WHERE id = ${connectorId}
    `);
  });
}

export async function runMetaFetchLeadJob(
  ctx: RequestContext,
  payload: MetaFetchLeadPayload,
): Promise<FetchLeadOutcome> {
  const connector = await loadConnector(ctx, payload.connectorId);
  if (!connector) return 'connector_missing';
  if (connector.status !== 'active') return 'connector_missing';
  const token = typeof connector.config['pageAccessToken'] === 'string'
    ? (connector.config['pageAccessToken'] as string)
    : null;
  if (!token) {
    await markConnectorReconnectRequired(ctx, connector.id, 401);
    return 'reconnect_required';
  }
  const graphVersion = loadConfig().META_GRAPH_VERSION;
  let lead;
  try {
    lead = await fetchMetaLead(fetcher, token, payload.leadgenId, graphVersion);
  } catch (err) {
    if (err instanceof MetaReconnectRequiredError) {
      await markConnectorReconnectRequired(ctx, connector.id, err.status);
      return 'reconnect_required';
    }
    if (err instanceof MetaFetchFailedError) {
      return 'fetch_failed';
    }
    throw err;
  }

  const overrides = (connector.config['fieldMap'] ?? {}) as Record<string, string>;
  const mapped = normalizeFieldData(lead.field_data, overrides);
  await ingest(ctx, {
    connectorId: connector.id,
    externalLeadId: payload.leadgenId,
    ...(payload.formId !== null ? { externalFormId: payload.formId } : {}),
    ...(payload.createdTime !== null ? { providerSubmittedAt: new Date(payload.createdTime) } : {}),
    mappedFields: mapped,
  });
  return 'ingested';
}

export interface ReconcileResult {
  readonly connectorsConsidered: number;
  readonly enqueued: number;
  readonly errors: number;
}

export async function runMetaReconcileForOrganization(ctx: RequestContext): Promise<ReconcileResult> {
  const connectors = await db.query<{
    connectorId: string;
    externalAccountId: string;
    pageAccessToken: string | null;
  }>(
    ctx,
    sql`
      SELECT id                                     AS "connectorId",
             external_account_id                    AS "externalAccountId",
             (config->>'pageAccessToken')           AS "pageAccessToken"
        FROM sales_connector
       WHERE kind   = 'meta'
         AND status = 'active'
    `,
  );
  const graphVersion = loadConfig().META_GRAPH_VERSION;
  let enqueued = 0;
  let errors = 0;
  for (const connector of connectors) {
    if (!connector.pageAccessToken || !connector.externalAccountId) continue;
    try {
      const discovered = await listRecentLeadsForPage(
        fetcher,
        connector.pageAccessToken,
        connector.externalAccountId,
        graphVersion,
      );
      if (discovered.length === 0) continue;
      const existing = await db.transaction(ctx, (tx) =>
        findExistingSubmissionKeys(tx, ctx.organizationId, connector.connectorId, discovered.map((d) => d.leadgenId)),
      );
      const missing = fetchesMissingFromSubmissions(discovered, existing);
      for (const row of missing) {
        await metaFetchLeadJob.enqueue({
          organizationId: ctx.organizationId,
          key: row.leadgenId,
          payload: {
            connectorId: connector.connectorId,
            leadgenId: row.leadgenId,
            formId: row.formId,
            createdTime: row.createdTime,
          },
        });
        enqueued++;
      }
    } catch (_err) {
      errors++;
    }
  }
  return { connectorsConsidered: connectors.length, enqueued, errors };
}
