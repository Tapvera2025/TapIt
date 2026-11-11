import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { renderingAvailable } from './crawler/render.js';

/**
 * Per-site checkup settings. Every change writes a new revision, so a past
 * checkup still points at the settings it ran with. Manual and scheduled
 * checkups use the same defaults (they used to differ: 100 vs 1,000 pages).
 */

export type RenderPolicy = 'never' | 'heuristic' | 'always';
export type CrawlerIdentity = 'tapcrm' | 'browser';

export interface ScanConfig {
  id: string;
  maxPages: number;
  renderPolicy: RenderPolicy;
  maxRenderPages: number;
  respectRobots: boolean;
  followSitemaps: boolean;
  crawlDelayMs: number;
  exclusionPatterns: string[];
  crawlerIdentity: CrawlerIdentity;
  maxBytesPerPage: number;
}

export const SCAN_LIMITS = {
  maxPages: { min: 1, max: 5000 },
  maxRenderPages: { min: 0, max: 500 },
  crawlDelayMs: { min: 0, max: 10_000 },
  exclusionPatterns: { max: 50, length: 200 },
} as const;

export function defaultScanConfig(): Omit<ScanConfig, 'id'> {
  const rendering = renderingAvailable();
  return {
    maxPages: 250,
    renderPolicy: rendering ? 'heuristic' : 'never',
    maxRenderPages: rendering ? 50 : 0,
    respectRobots: true,
    followSitemaps: true,
    crawlDelayMs: 500,
    exclusionPatterns: [],
    crawlerIdentity: 'tapcrm',
    maxBytesPerPage: 5 * 1024 * 1024,
  };
}

interface ConfigRow {
  id: string;
  maxPages: number;
  renderPolicy: RenderPolicy;
  maxRenderPages: number;
  respectRobots: boolean;
  followSitemaps: boolean;
  crawlDelayMs: number;
  exclusionPatterns: string[];
  configJson: Record<string, unknown> | null;
  maxBytesPerPage: number;
}

function fromRow(row: ConfigRow): ScanConfig {
  return {
    id: row.id,
    maxPages: row.maxPages,
    renderPolicy: row.renderPolicy,
    maxRenderPages: row.maxRenderPages,
    respectRobots: row.respectRobots,
    followSitemaps: row.followSitemaps,
    crawlDelayMs: row.crawlDelayMs,
    exclusionPatterns: row.exclusionPatterns,
    crawlerIdentity: row.configJson?.['crawlerIdentity'] === 'browser' ? 'browser' : 'tapcrm',
    maxBytesPerPage: row.maxBytesPerPage,
  };
}

const COLUMNS = sql`id, max_pages, render_policy, max_render_pages, respect_robots, follow_sitemaps,
  crawl_delay_ms, exclusion_patterns, config_json, max_bytes_per_page`;

async function latestRow(tx: Tx, organizationId: string, siteId: string): Promise<ConfigRow | null> {
  return tx.maybeOne<ConfigRow>(sql`
    SELECT ${COLUMNS} FROM seo_scan_configs
    WHERE organization_id = ${organizationId} AND site_id = ${siteId}
    ORDER BY revision DESC, created_at DESC LIMIT 1
  `);
}

async function insertRevision(
  tx: Tx,
  organizationId: string,
  siteId: string,
  config: Omit<ScanConfig, 'id'>,
): Promise<ScanConfig> {
  const row = await tx.one<ConfigRow>(sql`
    INSERT INTO seo_scan_configs
      (id, organization_id, site_id, revision, max_pages, render_policy, max_render_pages,
       respect_robots, follow_sitemaps, crawl_delay_ms, exclusion_patterns, config_json, max_bytes_per_page)
    SELECT ${randomUUID()}, ${organizationId}, ${siteId},
           COALESCE(MAX(revision), 0) + 1, ${config.maxPages}, ${config.renderPolicy}, ${config.maxRenderPages},
           ${config.respectRobots}, ${config.followSitemaps}, ${config.crawlDelayMs},
           ${config.exclusionPatterns}::text[], ${JSON.stringify({ crawlerIdentity: config.crawlerIdentity })}::jsonb,
           ${config.maxBytesPerPage}
    FROM seo_scan_configs WHERE organization_id = ${organizationId} AND site_id = ${siteId}
    RETURNING ${COLUMNS}
  `);
  return fromRow(row);
}

/** The latest settings for a site, creating the default revision when none exists. */
export async function ensureScanConfig(tx: Tx, organizationId: string, siteId: string): Promise<ScanConfig> {
  const row = await latestRow(tx, organizationId, siteId);
  return row ? fromRow(row) : insertRevision(tx, organizationId, siteId, defaultScanConfig());
}

export async function getScanConfig(ctx: RequestContext, siteId: string): Promise<ScanConfig> {
  return db.transaction(ctx, (tx) => ensureScanConfig(tx, ctx.organizationId, siteId));
}

export async function updateScanConfig(
  ctx: RequestContext,
  siteId: string,
  patch: Partial<Omit<ScanConfig, 'id' | 'maxBytesPerPage' | 'followSitemaps'>> & { followSitemaps?: boolean },
): Promise<ScanConfig> {
  return db.transaction(ctx, async (tx) => {
    await tx.one(sql`SELECT id FROM seo_sites WHERE organization_id = ${ctx.organizationId} AND id = ${siteId} FOR UPDATE`);
    const current = await ensureScanConfig(tx, ctx.organizationId, siteId);
    const { id: _id, ...base } = current;
    const next = { ...base, ...patch };
    if (next.renderPolicy === 'never') next.maxRenderPages = 0;
    else if (next.maxRenderPages === 0) next.maxRenderPages = Math.min(50, next.maxPages);
    const unchanged = (Object.keys(next) as Array<keyof typeof next>).every(
      (key) => JSON.stringify(next[key]) === JSON.stringify(base[key]),
    );
    return unchanged ? current : insertRevision(tx, ctx.organizationId, siteId, next);
  });
}

/** The settings a particular checkup runs with. */
export async function configForRun(ctx: RequestContext, scanRunId: string): Promise<ScanConfig> {
  const row = await db.one<ConfigRow>(ctx, sql`
    SELECT c.id, c.max_pages, c.render_policy, c.max_render_pages, c.respect_robots, c.follow_sitemaps,
           c.crawl_delay_ms, c.exclusion_patterns, c.config_json, c.max_bytes_per_page
    FROM seo_scan_configs c
    JOIN seo_scan_runs r ON r.config_id = c.id AND r.organization_id = c.organization_id
    WHERE r.organization_id = ${ctx.organizationId} AND r.id = ${scanRunId}
  `);
  return fromRow(row);
}
