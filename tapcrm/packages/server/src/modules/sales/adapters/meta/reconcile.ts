/**
 * Sales v1.1 — Meta Lead Ads reconciliation (R1 plan step 1.7).
 *
 * The webhook may miss a notification (Meta queue outage, our Redis
 * dropping an unacked message, a page token freshly rotated). The
 * reconcile sweep closes that gap every 15 minutes by listing recent
 * leads from the Graph API and enqueueing fetches for anything we
 * haven't already stored a submission for.
 *
 * Pure helpers here; the job handler in `jobs.ts` wires in the real
 * fetcher and queue so the diff logic can be unit-tested in isolation.
 */

import type { Tx } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import type { GraphFormLead, MetaFetcher } from './retrieval.js';

export interface ReconcileConnectorRow {
  readonly connectorId: string;
  readonly externalAccountId: string;
  readonly pageAccessToken: string | null;
}

/**
 * Pull the ids of leadgen events we have already stored a submission for
 * so the reconcile sweep enqueues only new work.
 */
export async function findExistingSubmissionKeys(
  tx: Tx,
  organizationId: string,
  connectorId: string,
  leadgenIds: readonly string[],
): Promise<Set<string>> {
  if (leadgenIds.length === 0) return new Set();
  const rows = await tx.query<{ externalLeadId: string }>(sql`
    SELECT external_lead_id AS "externalLeadId"
      FROM lead_submission
     WHERE organization_id = ${organizationId}
       AND connector_id    = ${connectorId}
       AND external_lead_id = ANY(${leadgenIds as unknown as string[]}::text[])
  `);
  return new Set(rows.map((r) => r.externalLeadId));
}

export interface GraphLeadDiscovery {
  readonly leadgenId: string;
  readonly formId: string | null;
  readonly createdTime: string | null;
}

/**
 * Pure diff: given everything Graph says exists and the keys we already
 * have on file, return the fetches we should enqueue. Order is stable
 * so tests can assert exact enqueue arguments.
 */
export function fetchesMissingFromSubmissions(
  discovered: readonly GraphLeadDiscovery[],
  existingKeys: ReadonlySet<string>,
): GraphLeadDiscovery[] {
  const unique = new Map<string, GraphLeadDiscovery>();
  for (const row of discovered) {
    if (!existingKeys.has(row.leadgenId)) unique.set(row.leadgenId, row);
  }
  return [...unique.values()];
}

/**
 * Lists `leadgen_forms` for the page and returns the recent lead ids
 * nested under them. Meta's shape puts `leads` inline when queried with
 * `fields=id,name,leads{created_time}`; non-admin tokens may return
 * empty arrays, which this helper treats as "nothing new".
 */
export async function listRecentLeadsForPage(
  fetcher: MetaFetcher,
  pageAccessToken: string,
  pageId: string,
  graphVersion: string,
): Promise<GraphLeadDiscovery[]> {
  const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name,leads{created_time}&limit=50`;
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${pageAccessToken}` },
  });
  if (!response.ok) return [];
  const body = (await response.json()) as {
    data?: Array<{ id: string; leads?: { data?: GraphFormLead[] } }>;
  };
  const discoveries: GraphLeadDiscovery[] = [];
  for (const form of body.data ?? []) {
    for (const lead of form.leads?.data ?? []) {
      discoveries.push({
        leadgenId: lead.id,
        formId: form.id ?? null,
        createdTime: lead.created_time ?? null,
      });
    }
  }
  return discoveries;
}
