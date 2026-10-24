import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { ProjectNotFoundError, ProjectValidationError } from '../errors.js';
import { findProjectById } from '../repository.js';
import { SearchConsoleConfigurationError, SearchConsoleUnavailableError, listSites } from '../../../platform/integrations/google/search-console.js';
import { googleAuthConfigured } from '../../../platform/integrations/google/token.js';
import { systemClock } from '../../../platform/time.js';
import { archiveBlog, archiveKeyword, deleteSearchConsoleLink, findKeyword, findSearchConsoleLink, insertBlog, insertKeyword, keywordExists, listBlogs, listKeywords, overview, rankHistory, toReport, updateBlog, updateKeyword, updateKeywordRank, upsertSearchConsoleLink, type ReportContext } from './repository.js';
import { observationWindow, syncProjectRanks } from './sync.js';
import type { BlogInput, CreateKeywordInput, RankUpdateInput, ReportQuery, SearchConsoleLinkInput, UpdateKeywordInput } from './validators.js';

export async function loadProjectReportResource(ctx: RequestContext, id: string): Promise<Resource | null> { const project = await findProjectById(ctx, id); return project ? { type: 'project', id: project.id, organizationId: project.organizationId, createdBy: project.createdBy, assigneeIds: project.assignees.map((a) => a.userId) } : null; }
function withProject(ctx: RequestContext, id: string): ReportContext { return { ...ctx, projectId: id }; }
export async function getSeoReport(ctx: RequestContext, projectId: string, query: ReportQuery) { const scoped = withProject(ctx, projectId); const [keywords, blogs, summary] = await Promise.all([listKeywords(scoped, query), listBlogs(scoped, query), overview(scoped, query.period)]); return toReport(keywords.items, blogs, keywords, summary, query.period); }
export async function createSeoKeyword(ctx: RequestContext, projectId: string, input: CreateKeywordInput) { const scoped = withProject(ctx, projectId); if (await keywordExists(scoped, projectId, input)) throw new ProjectValidationError('This keyword configuration is already being tracked. Change the URL, location, device, or search engine.'); const id = await db.transaction(scoped, (tx) => insertKeyword(tx, scoped, input)); return findKeyword(scoped, id); }
export async function editSeoKeyword(ctx: RequestContext, projectId: string, keywordId: string, input: UpdateKeywordInput) { const scoped = withProject(ctx, projectId); const current = await findKeyword(scoped, keywordId); if (!current) throw new ProjectNotFoundError(); const duplicateCheck = { keyword: input.keyword ?? current.keyword, targetUrl: input.targetUrl !== undefined ? input.targetUrl : current.targetUrl, keywordLink: input.keywordLink !== undefined ? input.keywordLink : current.keywordLink, searchEngine: (input.searchEngine ?? current.searchEngine) as 'google' | 'bing', country: input.country ?? current.country, city: input.city !== undefined ? input.city : current.city, device: input.device ?? current.device, autoFetchFrequency: (input.autoFetchFrequency ?? current.autoFetchFrequency) as 'manual' | 'daily' | 'weekly' | 'monthly', priority: input.priority ?? current.priority, category: input.category ?? current.category, notes: input.notes !== undefined ? input.notes : current.notes }; if (await keywordExists(scoped, projectId, duplicateCheck, keywordId)) throw new ProjectValidationError('This keyword configuration is already being tracked.'); await db.transaction(scoped, (tx) => updateKeyword(tx, scoped, keywordId, input)); return findKeyword(scoped, keywordId); }
export async function updateSeoRank(ctx: RequestContext, projectId: string, keywordId: string, input: RankUpdateInput) { const scoped = withProject(ctx, projectId); if (!await findKeyword(scoped, keywordId)) throw new ProjectNotFoundError(); await db.transaction(scoped, (tx) => updateKeywordRank(tx, scoped, keywordId, input.rank, input.status)); return findKeyword(scoped, keywordId); }
export async function getSeoRankHistory(ctx: RequestContext, projectId: string, keywordId: string) { const scoped = withProject(ctx, projectId); if (!await findKeyword(scoped, keywordId)) throw new ProjectNotFoundError(); return rankHistory(scoped, keywordId); }
export async function archiveSeoKeyword(ctx: RequestContext, projectId: string, keywordId: string) { const scoped = withProject(ctx, projectId); if (!await findKeyword(scoped, keywordId)) throw new ProjectNotFoundError(); await archiveKeyword(scoped, keywordId); return { archived: true }; }
export async function createSeoBlog(ctx: RequestContext, projectId: string, input: BlogInput) { const scoped = withProject(ctx, projectId); const id = await db.transaction(scoped, (tx) => insertBlog(tx, scoped, input)); return { id }; }
export async function editSeoBlog(ctx: RequestContext, projectId: string, blogId: string, input: BlogInput) { const scoped = withProject(ctx, projectId); await db.transaction(scoped, (tx) => updateBlog(tx, scoped, blogId, input)); return { id: blogId }; }
export async function archiveSeoBlog(ctx: RequestContext, projectId: string, blogId: string) { const scoped = withProject(ctx, projectId); await archiveBlog(scoped, blogId); return { archived: true }; }

/* ------------------------------------------------------------------ *
 * Search Console linking and automatic rank fetching.
 * ------------------------------------------------------------------ */

/**
 * The project's property plus every property the configured Google account can
 * read, so the UI offers a list instead of asking someone to type an exact
 * property string.
 *
 * Listing properties reaches Google, which may be unconfigured or refuse the
 * credentials. That is reported as part of the payload rather than as a failed
 * request: the link itself is still readable and editable, and the card needs
 * to be able to say why the list is empty.
 */
export async function getSearchConsoleSettings(ctx: RequestContext, projectId: string) {
  const link = await findSearchConsoleLink(ctx, projectId);
  if (!googleAuthConfigured()) {
    return { configured: false, link, properties: [], error: 'Google Search Console is not configured on this server.' };
  }
  try {
    const sites = await listSites();
    return {
      configured: true,
      link,
      properties: sites.map((site) => ({ propertyUrl: site.siteUrl, permissionLevel: site.permissionLevel })),
      error: null,
    };
  } catch (cause) {
    const message = cause instanceof SearchConsoleConfigurationError || cause instanceof SearchConsoleUnavailableError
      ? cause.message
      : 'Search Console could not be reached.';
    return { configured: true, link, properties: [], error: message };
  }
}

export async function linkSearchConsoleProperty(ctx: RequestContext, projectId: string, input: SearchConsoleLinkInput) {
  const scoped = withProject(ctx, projectId);
  if (!await findProjectById(ctx, projectId)) throw new ProjectNotFoundError();
  const propertyType = input.propertyUrl.startsWith('sc-domain:') ? 'domain' : 'url-prefix';
  await db.transaction(scoped, (tx) => upsertSearchConsoleLink(tx, scoped, input.propertyUrl, propertyType));
  return findSearchConsoleLink(ctx, projectId);
}

export async function unlinkSearchConsoleProperty(ctx: RequestContext, projectId: string) {
  const scoped = withProject(ctx, projectId);
  await deleteSearchConsoleLink(scoped);
  return { unlinked: true };
}

/**
 * "Sync now". Runs the same `syncProjectRanks` the scheduled job runs, so the
 * button and the schedule cannot drift apart — but with `scope: 'all'`:
 * someone pressing it wants every automatic keyword refreshed, not only those
 * whose frequency has come due.
 */
export async function syncSearchConsoleRanks(ctx: RequestContext, projectId: string) {
  if (!await findProjectById(ctx, projectId)) throw new ProjectNotFoundError();
  const window = await observationWindow(ctx, systemClock);
  return syncProjectRanks(ctx, projectId, { window, scope: 'all' });
}
