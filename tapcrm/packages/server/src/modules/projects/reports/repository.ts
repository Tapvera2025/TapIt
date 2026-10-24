import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { SeoBlogPost, SeoCategory, SeoDevice, SeoOverview, SeoPriority, SeoReport, SeoTrend } from './types.js';
import type { BlogInput, CreateKeywordInput, ReportQuery, UpdateKeywordInput } from './validators.js';
import { withinReportPeriod, type ReportPeriod } from './period.js';

export type ReportContext = RequestContext & { readonly projectId: string };

type KeywordRow = { id: string; projectId: string; keyword: string; pastRank: number | null; previousRank: number | null; currentRank: number | null; targetUrl: string | null; keywordLink: string | null; searchEngine: string; country: string; city: string | null; device: SeoDevice; autoFetchFrequency: string; priority: SeoPriority; category: SeoCategory; notes: string | null; lastCheckedAt: Date | null; createdAt: Date; updatedAt: Date; trend: SeoTrend; rankChange: number | null; lastAutoFetchAt: Date | null; lastAutoFetchOutcome: FetchOutcome | null; lastAutoFetchMessage: string | null };

function keywordSelect() {
  return sql`SELECT k.id, k.project_id AS "projectId", k.keyword, k.past_rank AS "pastRank", k.previous_rank AS "previousRank", k.current_rank AS "currentRank", k.target_url AS "targetUrl", k.keyword_link AS "keywordLink", k.search_engine AS "searchEngine", k.country, k.city, k.device, k.auto_fetch_frequency AS "autoFetchFrequency", k.priority, k.category, k.notes, k.last_checked_at AS "lastCheckedAt", k.last_auto_fetch_at AS "lastAutoFetchAt", k.last_auto_fetch_outcome AS "lastAutoFetchOutcome", k.last_auto_fetch_message AS "lastAutoFetchMessage", k.created_at AS "createdAt", k.updated_at AS "updatedAt", CASE WHEN k.previous_rank IS NULL OR k.current_rank IS NULL THEN 'unclassified' WHEN k.previous_rank > k.current_rank THEN 'improving' WHEN k.previous_rank < k.current_rank THEN 'declining' ELSE 'stagnant' END AS trend, CASE WHEN k.previous_rank IS NULL OR k.current_rank IS NULL THEN NULL ELSE k.previous_rank - k.current_rank END AS "rankChange" FROM project_seo_keyword k`;
}

export async function keywordExists(ctx: ReportContext, projectId: string, input: CreateKeywordInput | UpdateKeywordInput, excludeId?: string): Promise<boolean> {
  const row = await db.maybeOne<{ id: string }>(ctx, sql`SELECT id FROM project_seo_keyword WHERE organization_id = ${ctx.organizationId} AND project_id = ${projectId} AND archived_at IS NULL AND lower(trim(keyword)) = lower(trim(${input.keyword ?? ''})) AND lower(coalesce(target_url, '')) = lower(coalesce(${input.targetUrl ?? null}, '')) AND lower(country) = lower(${input.country ?? 'global'}) AND lower(coalesce(city, '')) = lower(coalesce(${input.city ?? null}, '')) AND search_engine = ${input.searchEngine ?? 'google'} AND device = ${input.device ?? 'desktop'} AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)`);
  return row !== null;
}

export async function insertKeyword(tx: Tx, ctx: ReportContext, input: CreateKeywordInput): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`INSERT INTO project_seo_keyword (organization_id, project_id, keyword, past_rank, previous_rank, current_rank, target_url, keyword_link, search_engine, country, city, device, auto_fetch_frequency, priority, category, notes, last_checked_at, created_by) VALUES (${ctx.organizationId}, ${ctx.projectId}, ${input.keyword}, NULL, NULL, ${input.currentRank}, ${input.targetUrl ?? null}, ${input.keywordLink ?? null}, ${input.searchEngine}, ${input.country}, ${input.city ?? null}, ${input.device}, ${input.autoFetchFrequency}, ${input.priority}, ${input.category}, ${input.notes ?? null}, now(), ${ctx.principal.id}) RETURNING id`);
  await tx.query(sql`INSERT INTO project_seo_rank_history (organization_id, keyword_id, observed_rank, source, status, created_by) VALUES (${ctx.organizationId}, ${row.id}, ${input.currentRank}, 'manual', ${input.currentRank === null ? 'unavailable' : 'available'}, ${ctx.principal.id})`);
  return row.id;
}

export async function updateKeyword(tx: Tx, ctx: ReportContext, id: string, input: UpdateKeywordInput): Promise<void> {
  await tx.query(sql`UPDATE project_seo_keyword SET keyword = COALESCE(${input.keyword ?? null}, keyword), target_url = CASE WHEN ${input.targetUrl !== undefined} THEN ${input.targetUrl ?? null} ELSE target_url END, keyword_link = CASE WHEN ${input.keywordLink !== undefined} THEN ${input.keywordLink ?? null} ELSE keyword_link END, search_engine = COALESCE(${input.searchEngine ?? null}, search_engine), country = COALESCE(${input.country ?? null}, country), city = CASE WHEN ${input.city !== undefined} THEN ${input.city ?? null} ELSE city END, device = COALESCE(${input.device ?? null}, device), auto_fetch_frequency = COALESCE(${input.autoFetchFrequency ?? null}, auto_fetch_frequency), priority = COALESCE(${input.priority ?? null}, priority), category = COALESCE(${input.category ?? null}, category), notes = CASE WHEN ${input.notes !== undefined} THEN ${input.notes ?? null} ELSE notes END, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${id} AND project_id = ${ctx.projectId} AND archived_at IS NULL`);
}

export async function updateKeywordRank(tx: Tx, ctx: ReportContext, id: string, rank: number | null, status: 'available' | 'unavailable'): Promise<void> {
  await tx.query(sql`UPDATE project_seo_keyword SET past_rank = previous_rank, previous_rank = current_rank, current_rank = ${rank}, last_checked_at = now(), updated_at = now() WHERE organization_id = ${ctx.organizationId} AND project_id = ${ctx.projectId} AND id = ${id} AND archived_at IS NULL`);
  await tx.query(sql`INSERT INTO project_seo_rank_history (organization_id, keyword_id, observed_rank, source, status, created_by) VALUES (${ctx.organizationId}, ${id}, ${rank}, 'manual', ${status}, ${ctx.principal.id})`);
}

export async function archiveKeyword(ctx: ReportContext, id: string): Promise<void> { await db.query(ctx, sql`UPDATE project_seo_keyword SET archived_at = now(), updated_at = now() WHERE organization_id = ${ctx.organizationId} AND project_id = ${ctx.projectId} AND id = ${id} AND archived_at IS NULL`); }

export async function findKeyword(ctx: ReportContext, id: string): Promise<KeywordRow | null> { return db.maybeOne<KeywordRow>(ctx, sql`${keywordSelect()} WHERE k.organization_id = ${ctx.organizationId} AND k.project_id = ${ctx.projectId} AND k.id = ${id} AND k.archived_at IS NULL`); }

export async function listKeywords(ctx: ReportContext, query: ReportQuery): Promise<{ items: KeywordRow[]; total: number; page: number; pageSize: number }> {
  const page = query.keywordPage; const pageSize = 20;
  const trendClause = query.keywordTrend === 'improving' ? sql`AND k.previous_rank IS NOT NULL AND k.current_rank IS NOT NULL AND k.previous_rank > k.current_rank` : query.keywordTrend === 'declining' ? sql`AND k.previous_rank IS NOT NULL AND k.current_rank IS NOT NULL AND k.previous_rank < k.current_rank` : query.keywordTrend === 'stagnant' ? sql`AND k.previous_rank IS NOT NULL AND k.current_rank IS NOT NULL AND k.previous_rank = k.current_rank` : query.keywordTrend === 'unclassified' ? sql`AND (k.previous_rank IS NULL OR k.current_rank IS NULL)` : sql``;
  const clauses = [query.keywordSearch ? sql`AND (k.keyword ILIKE ${`%${query.keywordSearch}%`} OR k.target_url ILIKE ${`%${query.keywordSearch}%`})` : sql``, query.keywordCategory !== 'all' ? sql`AND k.category = ${query.keywordCategory}` : sql``, query.keywordPriority !== 'all' ? sql`AND k.priority = ${query.keywordPriority}` : sql``, query.keywordDevice !== 'all' ? sql`AND k.device = ${query.keywordDevice}` : sql``, trendClause, sql`AND k.archived_at IS NULL`, sql`AND ${withinReportPeriod('k.updated_at', query.period)}`];
  const where = sql.join(clauses, ' ');
  const items = await db.query<KeywordRow>(ctx, sql`${keywordSelect()} WHERE k.organization_id = ${ctx.organizationId} AND k.project_id = ${ctx.projectId} ${where} ORDER BY k.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  const total = await db.one<{ count: string }>(ctx, sql`SELECT count(*)::text AS count FROM project_seo_keyword k WHERE k.organization_id = ${ctx.organizationId} AND k.project_id = ${ctx.projectId} ${where}`);
  return { items, total: Number(total.count), page, pageSize };
}

export async function rankHistory(ctx: ReportContext, id: string): Promise<Array<{ id: string; rank: number | null; source: string; status: string; observedAt: Date; exactPosition: number | null; impressions: string | null; clicks: string | null; windowStart: Date | null; windowEnd: Date | null; unavailableReason: string | null }>> { return db.query(ctx, sql`SELECT id, observed_rank AS rank, source, status, observed_at AS "observedAt", exact_position::float AS "exactPosition", impressions::text AS impressions, clicks::text AS clicks, window_start AS "windowStart", window_end AS "windowEnd", unavailable_reason AS "unavailableReason" FROM project_seo_rank_history WHERE organization_id = ${ctx.organizationId} AND keyword_id = ${id} ORDER BY observed_at ASC`); }

export async function insertBlog(tx: Tx, ctx: ReportContext, input: BlogInput): Promise<string> { const row = await tx.one<{ id: string }>(sql`INSERT INTO project_seo_blog_post (organization_id, project_id, title, url, description, category, status, publish_date, word_count, notes, created_by) VALUES (${ctx.organizationId}, ${ctx.projectId}, ${input.title}, ${input.url ?? null}, ${input.description ?? null}, ${input.category}, ${input.status}, ${input.publishDate ?? null}::date, ${input.wordCount}, ${input.notes ?? null}, ${ctx.principal.id}) RETURNING id`); await replaceBlogKeywords(tx, ctx, row.id, input.targetKeywords); return row.id; }
export async function updateBlog(tx: Tx, ctx: ReportContext, id: string, input: BlogInput): Promise<void> { await tx.query(sql`UPDATE project_seo_blog_post SET title = ${input.title}, url = ${input.url ?? null}, description = ${input.description ?? null}, category = ${input.category}, status = ${input.status}, publish_date = ${input.publishDate ?? null}::date, word_count = ${input.wordCount}, notes = ${input.notes ?? null}, archived_at = CASE WHEN ${input.status === 'archived'} THEN COALESCE(archived_at, now()) ELSE NULL END, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND project_id = ${ctx.projectId} AND id = ${id}`); await replaceBlogKeywords(tx, ctx, id, input.targetKeywords); }
export async function archiveBlog(ctx: ReportContext, id: string): Promise<void> { await db.query(ctx, sql`UPDATE project_seo_blog_post SET archived_at = now(), status = 'archived', updated_at = now() WHERE organization_id = ${ctx.organizationId} AND project_id = ${ctx.projectId} AND id = ${id} AND archived_at IS NULL`); }
async function replaceBlogKeywords(tx: Tx, ctx: ReportContext, blogId: string, keywords: string[]): Promise<void> { await tx.query(sql`DELETE FROM project_seo_blog_keyword WHERE organization_id = ${ctx.organizationId} AND blog_post_id = ${blogId}`); for (const keyword of [...new Set(keywords.map((v) => v.trim()).filter(Boolean))]) await tx.query(sql`INSERT INTO project_seo_blog_keyword (organization_id, blog_post_id, keyword) VALUES (${ctx.organizationId}, ${blogId}, ${keyword})`); }
export async function listBlogs(ctx: ReportContext, query: ReportQuery): Promise<{ items: SeoBlogPost[]; total: number; page: number; pageSize: number }> {
  const page = query.blogPage;
  const pageSize = 10;
  const archiveClause = query.blogStatus === 'archived' ? sql`AND b.archived_at IS NOT NULL` : sql`AND b.archived_at IS NULL`;
  const clauses = [
    query.blogSearch ? sql`AND (b.title ILIKE ${`%${query.blogSearch}%`} OR EXISTS (SELECT 1 FROM project_seo_blog_keyword bk WHERE bk.organization_id = b.organization_id AND bk.blog_post_id = b.id AND bk.keyword ILIKE ${`%${query.blogSearch}%`}))` : sql``,
    query.blogStatus !== 'all' && query.blogStatus !== 'archived' ? sql`AND b.status = ${query.blogStatus}` : sql``,
    archiveClause,
    sql`AND ${withinReportPeriod('b.updated_at', query.period)}`,
  ];
  const where = sql.join(clauses, ' ');
  const rows = await db.query<SeoBlogPost>(ctx, sql`
    SELECT b.id,
           b.project_id AS "projectId",
           b.title,
           b.url,
           b.description,
           b.category,
           b.status,
           b.publish_date AS "publishDate",
           b.word_count AS "wordCount",
           b.notes,
           creator.full_name AS "createdByName",
           b.created_at AS "createdAt",
           b.updated_at AS "updatedAt",
           COALESCE(array_agg(bk.keyword ORDER BY bk.keyword) FILTER (WHERE bk.keyword IS NOT NULL), '{}') AS "targetKeywords"
      FROM project_seo_blog_post b
      LEFT JOIN app_user creator
        ON creator.organization_id = b.organization_id
       AND creator.id = b.created_by
      LEFT JOIN project_seo_blog_keyword bk
        ON bk.organization_id = b.organization_id
       AND bk.blog_post_id = b.id
     WHERE b.organization_id = ${ctx.organizationId}
       AND b.project_id = ${ctx.projectId}
       ${where}
     GROUP BY b.id, creator.full_name
     ORDER BY b.updated_at DESC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  const total = await db.one<{ count: string }>(ctx, sql`SELECT count(*)::text AS count FROM project_seo_blog_post b WHERE b.organization_id = ${ctx.organizationId} AND b.project_id = ${ctx.projectId} ${where}`);
  return { items: rows, total: Number(total.count), page, pageSize };
}

export async function overview(ctx: ReportContext, period: ReportPeriod = 90): Promise<SeoOverview> { const keywordPeriod = withinReportPeriod('k.updated_at', period); const blogPeriod = withinReportPeriod('b.updated_at', period); const row = await db.one<{ total: string; improving: string; declining: string; stagnant: string; unclassified: string; average: number | null; blogs: string; published: string; drafts: string; archived: string; lastUpdated: Date | null }>(ctx, sql`WITH k AS (SELECT current_rank, previous_rank, updated_at FROM project_seo_keyword k WHERE organization_id = ${ctx.organizationId} AND project_id = ${ctx.projectId} AND archived_at IS NULL AND ${keywordPeriod}), b AS (SELECT status, archived_at, updated_at FROM project_seo_blog_post b WHERE organization_id = ${ctx.organizationId} AND project_id = ${ctx.projectId} AND ${blogPeriod}) SELECT (SELECT count(*) FROM k)::text AS total, (SELECT count(*) FROM k WHERE previous_rank IS NOT NULL AND current_rank IS NOT NULL AND previous_rank > current_rank)::text AS improving, (SELECT count(*) FROM k WHERE previous_rank IS NOT NULL AND current_rank IS NOT NULL AND previous_rank < current_rank)::text AS declining, (SELECT count(*) FROM k WHERE previous_rank IS NOT NULL AND current_rank IS NOT NULL AND previous_rank = current_rank)::text AS stagnant, (SELECT count(*) FROM k WHERE previous_rank IS NULL OR current_rank IS NULL)::text AS unclassified, (SELECT avg(current_rank) FROM k)::float AS average, (SELECT count(*) FROM b WHERE archived_at IS NULL)::text AS blogs, (SELECT count(*) FROM b WHERE archived_at IS NULL AND status = 'published')::text AS published, (SELECT count(*) FROM b WHERE archived_at IS NULL AND status = 'draft')::text AS drafts, (SELECT count(*) FROM b WHERE archived_at IS NOT NULL)::text AS archived, GREATEST((SELECT max(updated_at) FROM k), (SELECT max(updated_at) FROM b)) AS "lastUpdated"`); return { totalKeywords: Number(row.total), improving: Number(row.improving), declining: Number(row.declining), stagnant: Number(row.stagnant), unclassified: Number(row.unclassified), averageCurrentRank: row.average === null ? null : Number(row.average), totalBlogs: Number(row.blogs), publishedBlogs: Number(row.published), draftBlogs: Number(row.drafts), archivedBlogs: Number(row.archived), lastUpdatedAt: row.lastUpdated }; }

export function toReport(keywordRows: KeywordRow[], blogResult: { items: SeoBlogPost[]; total: number; page: number; pageSize: number }, keywordResult: { total: number; page: number; pageSize: number }, summary: SeoOverview, period: 7 | 30 | 90): SeoReport { return { period, overview: summary, keywords: { items: keywordRows, total: keywordResult.total, page: keywordResult.page, pageSize: keywordResult.pageSize, totalPages: Math.max(1, Math.ceil(keywordResult.total / keywordResult.pageSize)) }, blogs: { items: blogResult.items, total: blogResult.total, page: blogResult.page, pageSize: blogResult.pageSize, totalPages: Math.max(1, Math.ceil(blogResult.total / blogResult.pageSize)) } }; }

/* ------------------------------------------------------------------ *
 * Automatic rank fetching — the project's Search Console property, the
 * keywords due for a fetch, and the write path for an observation no user
 * entered. See sync.ts for the orchestration.
 * ------------------------------------------------------------------ */

export type SyncStatus = 'ok' | 'partial' | 'failed';
export type FetchOutcome = 'ok' | 'no-data' | 'skipped' | 'failed';

export interface SearchConsoleLink {
  propertyUrl: string; propertyType: 'domain' | 'url-prefix'; lastSyncAt: Date | null;
  lastSyncStatus: SyncStatus | null; lastSyncMessage: string | null; keywordsSynced: number;
}

export interface DueKeyword {
  id: string; keyword: string; targetUrl: string | null; searchEngine: string;
  category: SeoCategory; country: string; city: string | null; device: SeoDevice;
  autoFetchFrequency: string;
}

function linkSelect() {
  return sql`SELECT property_url AS "propertyUrl", property_type AS "propertyType", last_sync_at AS "lastSyncAt", last_sync_status AS "lastSyncStatus", last_sync_message AS "lastSyncMessage", keywords_synced AS "keywordsSynced" FROM project_seo_search_console`;
}

export async function findSearchConsoleLink(ctx: RequestContext, projectId: string): Promise<SearchConsoleLink | null> {
  return db.maybeOne<SearchConsoleLink>(ctx, sql`${linkSelect()} WHERE organization_id = ${ctx.organizationId} AND project_id = ${projectId}`);
}

export async function upsertSearchConsoleLink(tx: Tx, ctx: ReportContext, propertyUrl: string, propertyType: 'domain' | 'url-prefix'): Promise<void> {
  // Re-pointing a project at a DIFFERENT property clears the previous sync
  // result: it described another site, and left in place it would read as this
  // one's status. Re-saving the same property keeps its history.
  const changed = sql`project_seo_search_console.property_url <> EXCLUDED.property_url`;
  await tx.query(sql`INSERT INTO project_seo_search_console (organization_id, project_id, property_url, property_type, created_by) VALUES (${ctx.organizationId}, ${ctx.projectId}, ${propertyUrl}, ${propertyType}, ${ctx.principal.id}) ON CONFLICT (organization_id, project_id) DO UPDATE SET property_url = EXCLUDED.property_url, property_type = EXCLUDED.property_type, last_sync_at = CASE WHEN ${changed} THEN NULL ELSE project_seo_search_console.last_sync_at END, last_sync_status = CASE WHEN ${changed} THEN NULL ELSE project_seo_search_console.last_sync_status END, last_sync_message = CASE WHEN ${changed} THEN NULL ELSE project_seo_search_console.last_sync_message END, keywords_synced = CASE WHEN ${changed} THEN 0 ELSE project_seo_search_console.keywords_synced END, updated_at = now()`);
}

export async function deleteSearchConsoleLink(ctx: ReportContext): Promise<void> {
  await db.query(ctx, sql`DELETE FROM project_seo_search_console WHERE organization_id = ${ctx.organizationId} AND project_id = ${ctx.projectId}`);
}

export async function recordSyncOutcome(tx: Tx, ctx: RequestContext, projectId: string, status: SyncStatus, message: string | null, keywordsSynced: number): Promise<void> {
  await tx.query(sql`UPDATE project_seo_search_console SET last_sync_at = now(), last_sync_status = ${status}, last_sync_message = ${message}, keywords_synced = ${keywordsSynced}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND project_id = ${projectId}`);
}

/**
 * The interval each frequency owes, set slightly under its nominal period so a
 * daily job that runs at 04:20 is not pushed to 04:21 the next day and misses
 * its slot a month later. 'manual' can never come due.
 */
/**
 * `priority` is text, so ORDER BY priority DESC sorts alphabetically — medium,
 * low, high — and the per-run cap would then drop the high-priority keywords
 * first. Ranked explicitly instead.
 */
function priorityOrder() {
  return sql`CASE k.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;
}

function dueInterval() {
  return sql`CASE k.auto_fetch_frequency WHEN 'daily' THEN interval '20 hours' WHEN 'weekly' THEN interval '6 days' WHEN 'monthly' THEN interval '27 days' ELSE interval '100 years' END`;
}

export async function dueKeywords(ctx: RequestContext, projectId: string, limit: number): Promise<DueKeyword[]> {
  return db.query<DueKeyword>(ctx, sql`SELECT k.id, k.keyword, k.target_url AS "targetUrl", k.search_engine AS "searchEngine", k.category, k.country, k.city, k.device, k.auto_fetch_frequency AS "autoFetchFrequency" FROM project_seo_keyword k WHERE k.organization_id = ${ctx.organizationId} AND k.project_id = ${projectId} AND k.archived_at IS NULL AND k.auto_fetch_frequency <> 'manual' AND (k.last_auto_fetch_at IS NULL OR k.last_auto_fetch_at < now() - ${dueInterval()}) ORDER BY ${priorityOrder()}, k.created_at LIMIT ${limit}`);
}

/** Every keyword of a project, due or not — what "Sync now" fetches. */
export async function automatableKeywords(ctx: RequestContext, projectId: string, limit: number): Promise<DueKeyword[]> {
  return db.query<DueKeyword>(ctx, sql`SELECT k.id, k.keyword, k.target_url AS "targetUrl", k.search_engine AS "searchEngine", k.category, k.country, k.city, k.device, k.auto_fetch_frequency AS "autoFetchFrequency" FROM project_seo_keyword k WHERE k.organization_id = ${ctx.organizationId} AND k.project_id = ${projectId} AND k.archived_at IS NULL AND k.auto_fetch_frequency <> 'manual' ORDER BY ${priorityOrder()}, k.created_at LIMIT ${limit}`);
}

/** Projects of this organization that have a property and at least one due keyword. */
export async function projectsDueForFetch(ctx: RequestContext): Promise<string[]> {
  const rows = await db.query<{ projectId: string }>(ctx, sql`SELECT c.project_id AS "projectId" FROM project_seo_search_console c WHERE c.organization_id = ${ctx.organizationId} AND EXISTS (SELECT 1 FROM project_seo_keyword k WHERE k.organization_id = c.organization_id AND k.project_id = c.project_id AND k.archived_at IS NULL AND k.auto_fetch_frequency <> 'manual' AND (k.last_auto_fetch_at IS NULL OR k.last_auto_fetch_at < now() - ${dueInterval()})) ORDER BY c.project_id`);
  return rows.map((row) => row.projectId);
}

export async function markFetchOutcome(tx: Tx, ctx: RequestContext, keywordId: string, outcome: FetchOutcome, message: string | null): Promise<void> {
  await tx.query(sql`UPDATE project_seo_keyword SET last_auto_fetch_at = now(), last_auto_fetch_outcome = ${outcome}, last_auto_fetch_message = ${message}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${keywordId} AND archived_at IS NULL`);
}

export interface AutomaticObservation {
  keywordId: string; provider: string; windowStart: string; windowEnd: string;
  rank: number | null; exactPosition: number | null; impressions: number | null;
  clicks: number | null; ctr: number | null; unavailableReason: 'not-ranked' | 'no-data' | null;
}

/**
 * Writes one automated observation.
 *
 * Two things here differ from the manual path in `updateKeywordRank`, both
 * deliberately:
 *
 *  1. The history row is upserted on (keyword, window). A redelivered or
 *     retried job refreshes the observation instead of appending a second one,
 *     and `xmax = 0` reports whether this call actually inserted — which is
 *     what decides the rank shift below. Shifting on every delivery would walk
 *     the rolling rank slots forward once per retry and invent a trend.
 *
 *  2. An unavailable observation does NOT blank `current_rank`. The manual
 *     path does, and should: a person choosing "unavailable" is stating they
 *     checked. But Search Console routinely omits low-impression queries, so
 *     applying that here would flip a real rank to NULL and back as
 *     impressions wobble. The history row records the truth; the keyword's
 *     last known rank stands, and `last_auto_fetch_outcome` says 'no-data'.
 */
export async function applyAutomaticObservation(tx: Tx, ctx: RequestContext, observation: AutomaticObservation): Promise<void> {
  const status = observation.rank === null ? 'unavailable' : 'available';
  const inserted = await tx.one<{ inserted: boolean }>(sql`
    INSERT INTO project_seo_rank_history (organization_id, keyword_id, observed_rank, source, status, created_by, provider, window_start, window_end, exact_position, impressions, clicks, ctr, unavailable_reason)
    VALUES (${ctx.organizationId}, ${observation.keywordId}, ${observation.rank}, 'automatic', ${status}, NULL, ${observation.provider}, ${observation.windowStart}::date, ${observation.windowEnd}::date, ${observation.exactPosition}, ${observation.impressions}, ${observation.clicks}, ${observation.ctr}, ${observation.unavailableReason})
    ON CONFLICT (organization_id, keyword_id, window_end) WHERE source = 'automatic'
    DO UPDATE SET observed_rank = EXCLUDED.observed_rank, status = EXCLUDED.status, exact_position = EXCLUDED.exact_position, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, ctr = EXCLUDED.ctr, unavailable_reason = EXCLUDED.unavailable_reason, window_start = EXCLUDED.window_start, observed_at = now()
    RETURNING (xmax = 0) AS inserted
  `);

  if (observation.rank === null) return;
  await tx.query(sql`UPDATE project_seo_keyword SET past_rank = CASE WHEN ${inserted.inserted} THEN previous_rank ELSE past_rank END, previous_rank = CASE WHEN ${inserted.inserted} THEN current_rank ELSE previous_rank END, current_rank = ${observation.rank}, last_checked_at = now(), updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${observation.keywordId} AND archived_at IS NULL`);
}
