import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { SeoSiteNotFoundError, SeoScanNotFoundError, SeoFindingNotFoundError } from './errors.js';
import type { DbSeoSite, DbSeoScanRun, DbSeoFinding, DbSeoGscMetrics } from './types.js';

// ─── Sites ───────────────────────────────────────────────────────────────────

export async function listSites(ctx: RequestContext): Promise<DbSeoSite[]> {
  return db.query<DbSeoSite>(ctx, sql`
    SELECT * FROM seo_sites
    WHERE organization_id = ${ctx.organizationId} AND active = true
    ORDER BY display_url
  `);
}

export async function getSite(ctx: RequestContext, siteId: string): Promise<DbSeoSite> {
  const row = await db.maybeOne<DbSeoSite>(ctx, sql`
    SELECT * FROM seo_sites
    WHERE organization_id = ${ctx.organizationId} AND id = ${siteId}
  `);
  if (!row) throw new SeoSiteNotFoundError();
  return row;
}

export async function createSite(
  ctx: RequestContext,
  args: {
    id: string;
    clientId: string | null;
    displayUrl: string;
    normalizedHost: string;
    scopePath: string;
    canonicalScheme: string;
    timezone: string;
    locale: string;
    businessIntents: string[];
    stackNotes: string | null;
  },
): Promise<DbSeoSite> {
  return db.one<DbSeoSite>(ctx, sql`
    INSERT INTO seo_sites
      (id, organization_id, client_id, display_url, normalized_host, scope_path,
       canonical_scheme, ownership_state, timezone, locale, business_intents, stack_notes)
    VALUES
      (${args.id}, ${ctx.organizationId}, ${args.clientId}, ${args.displayUrl},
       ${args.normalizedHost}, ${args.scopePath}, ${args.canonicalScheme},
       'unverified', ${args.timezone}, ${args.locale},
       ${args.businessIntents}::text[], ${args.stackNotes})
    RETURNING *
  `);
}

export async function updateSite(
  ctx: RequestContext,
  siteId: string,
  patch: Partial<Pick<DbSeoSite, 'display_url' | 'timezone' | 'locale' | 'business_intents' | 'stack_notes' | 'active'>>,
): Promise<DbSeoSite> {
  await getSite(ctx, siteId);
  // Each clause is its own sql fragment so values flow through the template's
  // parameter binding — not raw string substitution — and sql.join renumbers
  // the $N placeholders so they don't collide with the WHERE clause.
  const clauses = [];
  if (patch.display_url !== undefined) clauses.push(sql`display_url = ${patch.display_url}`);
  if (patch.timezone !== undefined) clauses.push(sql`timezone = ${patch.timezone}`);
  if (patch.locale !== undefined) clauses.push(sql`locale = ${patch.locale}`);
  if (patch.business_intents !== undefined) clauses.push(sql`business_intents = ${JSON.stringify(patch.business_intents)}::jsonb`);
  if (patch.stack_notes !== undefined) clauses.push(sql`stack_notes = ${patch.stack_notes}`);
  if (patch.active !== undefined) clauses.push(sql`active = ${patch.active}`);

  if (clauses.length === 0) return getSite(ctx, siteId);

  return db.one<DbSeoSite>(ctx, sql`
    UPDATE seo_sites
    SET ${sql.join(clauses)}, updated_at = now()
    WHERE organization_id = ${ctx.organizationId} AND id = ${siteId}
    RETURNING *
  `);
}

// ─── Scan Runs ────────────────────────────────────────────────────────────────

export async function listScanRuns(ctx: RequestContext, siteId: string, limit = 20): Promise<DbSeoScanRun[]> {
  return db.query<DbSeoScanRun>(ctx, sql`
    SELECT * FROM seo_scan_runs
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
    ORDER BY queued_at DESC
    LIMIT ${limit}
  `);
}

export async function getScanRun(ctx: RequestContext, scanRunId: string): Promise<DbSeoScanRun> {
  const row = await db.maybeOne<DbSeoScanRun>(ctx, sql`
    SELECT * FROM seo_scan_runs
    WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
  `);
  if (!row) throw new SeoScanNotFoundError();
  return row;
}

export async function createScanRun(
  tx: Tx,
  args: {
    id: string;
    organizationId: string;
    siteId: string;
    configId: string;
    ruleReleaseId: string;
    triggeredBy: string | null;
  },
): Promise<DbSeoScanRun> {
  return tx.one<DbSeoScanRun>(sql`
    INSERT INTO seo_scan_runs
      (id, organization_id, site_id, config_id, rule_release_id, status, triggered_by, queued_at)
    VALUES
      (${args.id}, ${args.organizationId}, ${args.siteId}, ${args.configId},
       ${args.ruleReleaseId}, 'queued', ${args.triggeredBy}, now())
    RETURNING *
  `);
}

// ─── Findings ─────────────────────────────────────────────────────────────────

export async function listFindings(
  ctx: RequestContext,
  siteId: string,
  opts: { status?: string | undefined; severity?: string | undefined; limit?: number | undefined; offset?: number | undefined } = {},
): Promise<{ rows: DbSeoFinding[]; total: number }> {
  const filters = [sql`f.organization_id = ${ctx.organizationId}`, sql`f.site_id = ${siteId}`];
  if (opts.status) filters.push(sql`f.status = ${opts.status}`);
  if (opts.severity) filters.push(sql`f.severity = ${opts.severity}`);
  const where = sql.join(filters, ' AND ');
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [rows, countRow] = await Promise.all([
    db.query<DbSeoFinding>(ctx, sql`
      SELECT f.*, f.priority_score::float AS priority_score,
             (SELECT fi.evidence FROM seo_finding_instances fi
                WHERE fi.finding_id = f.id
                ORDER BY fi.last_seen_at DESC
                LIMIT 1) AS evidence
      FROM seo_findings f
      WHERE ${where}
      ORDER BY f.priority_score DESC NULLS LAST, f.first_seen_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.one<{ count: string }>(ctx, sql`SELECT COUNT(*) AS count FROM seo_findings f WHERE ${where}`),
  ]);
  return { rows, total: parseInt(countRow.count, 10) };
}

export async function getFinding(ctx: RequestContext, findingId: string): Promise<DbSeoFinding> {
  const row = await db.maybeOne<DbSeoFinding>(ctx, sql`
    SELECT * FROM seo_findings WHERE organization_id = ${ctx.organizationId} AND id = ${findingId}
  `);
  if (!row) throw new SeoFindingNotFoundError();
  return row;
}

// ─── GSC Metrics ──────────────────────────────────────────────────────────────

export async function listGscMetrics(
  ctx: RequestContext,
  siteId: string,
  opts: { startDate: string; endDate: string; limit?: number },
): Promise<DbSeoGscMetrics[]> {
  return db.query<DbSeoGscMetrics>(ctx, sql`
    SELECT *, ctr::float AS ctr, avg_position::float AS avg_position FROM seo_gsc_metrics
    WHERE organization_id = ${ctx.organizationId}
      AND site_id = ${siteId}
      AND date BETWEEN ${opts.startDate}::date AND ${opts.endDate}::date
    ORDER BY date DESC, clicks DESC
    LIMIT ${opts.limit ?? 1000}
  `);
}

export async function upsertGscMetrics(
  tx: Tx,
  rows: Array<{
    id: string;
    organizationId: string;
    siteId: string;
    propertyUrl: string;
    date: string;
    searchType: string;
    query: string | null;
    page: string | null;
    country: string | null;
    device: string | null;
    clicks: number;
    impressions: number;
    ctr: number | null;
    avgPosition: number | null;
    dataComplete: boolean;
    rowLimitHit: boolean;
  }>,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 1000) {
    await tx.query(sql`
      INSERT INTO seo_gsc_metrics
        (id, organization_id, site_id, property_url, date, search_type, query, page,
         country, device, clicks, impressions, ctr, avg_position, data_complete, row_limit_hit, synced_at)
      SELECT r.id, r."organizationId", r."siteId", r."propertyUrl", r.date,
        r."searchType", r.query, r.page, r.country, r.device, r.clicks, r.impressions,
        r.ctr, r."avgPosition", r."dataComplete", r."rowLimitHit", now()
      FROM jsonb_to_recordset(${JSON.stringify(rows.slice(offset, offset + 1000))}::jsonb) AS r(
        id uuid, "organizationId" uuid, "siteId" uuid, "propertyUrl" text, date date,
        "searchType" text, query text, page text, country text, device text,
        clicks integer, impressions integer, ctr numeric, "avgPosition" numeric,
        "dataComplete" boolean, "rowLimitHit" boolean)
      ON CONFLICT (site_id, date, search_type, query, page, country, device)
        DO UPDATE SET clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions,
          ctr = EXCLUDED.ctr, avg_position = EXCLUDED.avg_position,
          property_url = EXCLUDED.property_url, data_complete = EXCLUDED.data_complete,
          row_limit_hit = EXCLUDED.row_limit_hit, synced_at = now()
    `);
  }

}
