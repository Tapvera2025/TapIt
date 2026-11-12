import { identityDownload, identityRequest } from '../../../identity/api/authApi.js';
import type { BlogInput, RankHistoryEntry, SearchConsoleSettings, SeoReport, SeoKeyword, SyncResult } from '../types.js';
export interface ClientFeedback { id: string; projectId: string; area: 'keyword-tracker' | 'blog-updates' | 'off-page-seo' | 'screenshots'; note: string; createdByName: string; createdAt: string; }

function path(projectId: string, suffix = ''): string { return `/api/projects/${encodeURIComponent(projectId)}/reports/on-page-seo${suffix}`; }
export function getProjectSeoReport(projectId: string, query: Record<string, string | number | undefined>): Promise<SeoReport> { const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); }); const suffix = params.toString() ? `?${params.toString()}` : ''; return identityRequest(`${path(projectId)}${suffix}`); }
export function downloadProjectReport(projectId: string): Promise<Blob> { return identityDownload(`/api/projects/${encodeURIComponent(projectId)}/reports/download`); }
export function createKeyword(projectId: string, input: Record<string, unknown>): Promise<SeoKeyword> { return identityRequest(path(projectId, '/keywords'), { method: 'POST', body: JSON.stringify(input) }); }
export function updateKeyword(projectId: string, keywordId: string, input: Record<string, unknown>): Promise<SeoKeyword> { return identityRequest(path(projectId, `/keywords/${encodeURIComponent(keywordId)}`), { method: 'PATCH', body: JSON.stringify(input) }); }
export function updateKeywordRank(projectId: string, keywordId: string, rank: number | null, status: 'available' | 'unavailable'): Promise<SeoKeyword> { return identityRequest(path(projectId, `/keywords/${encodeURIComponent(keywordId)}/rank`), { method: 'POST', body: JSON.stringify({ rank, status }) }); }
export function getKeywordHistory(projectId: string, keywordId: string): Promise<RankHistoryEntry[]> { return identityRequest(path(projectId, `/keywords/${encodeURIComponent(keywordId)}/history`)); }
export function archiveKeyword(projectId: string, keywordId: string): Promise<{ archived: true }> { return identityRequest(path(projectId, `/keywords/${encodeURIComponent(keywordId)}/archive`), { method: 'POST' }); }
export function createBlog(projectId: string, input: BlogInput): Promise<{ id: string }> { return identityRequest(path(projectId, '/blog-posts'), { method: 'POST', body: JSON.stringify(input) }); }
export function updateBlog(projectId: string, blogId: string, input: BlogInput): Promise<{ id: string }> { return identityRequest(path(projectId, `/blog-posts/${encodeURIComponent(blogId)}`), { method: 'PATCH', body: JSON.stringify(input) }); }
export function archiveBlog(projectId: string, blogId: string): Promise<{ archived: true }> { return identityRequest(path(projectId, `/blog-posts/${encodeURIComponent(blogId)}/archive`), { method: 'POST' }); }
export function getClientFeedback(projectId: string, area: ClientFeedback['area']): Promise<ClientFeedback[]> { return identityRequest(`/api/projects/${encodeURIComponent(projectId)}/reports/client-feedback?area=${encodeURIComponent(area)}`); }

export function getSearchConsoleSettings(projectId: string): Promise<SearchConsoleSettings> { return identityRequest(path(projectId, '/search-console')); }
export function linkSearchConsoleProperty(projectId: string, propertyUrl: string): Promise<unknown> { return identityRequest(path(projectId, '/search-console'), { method: 'PUT', body: JSON.stringify({ propertyUrl }) }); }
export function unlinkSearchConsoleProperty(projectId: string): Promise<{ unlinked: true }> { return identityRequest(path(projectId, '/search-console'), { method: 'DELETE' }); }
export function syncSearchConsoleRanks(projectId: string): Promise<SyncResult> { return identityRequest(path(projectId, '/search-console/sync'), { method: 'POST' }); }

export interface ProjectLiveSettings {
  /** The website set on the project, if any. */
  websiteUrl: string | null;
  /** The website live checks look for when a keyword has no target URL. */
  effectiveHost: string | null;
  websiteSource: 'project' | 'search-console' | null;
  monthlyLimit: number;
  searchDepth: 10 | 20 | 30 | 50 | 100;
  used: number;
  remaining: number;
  configured: boolean;
  provider: string;
}
export interface LiveTopResult {
  position: number;
  url: string | null;
  title: string | null;
}
export interface LiveCheckOutcome {
  source: 'live' | 'search-console';
  status: 'found' | 'not-found' | 'failed';
  position: number | null;
  url: string | null;
  title: string | null;
  location: string;
  engine: string;
  device: string;
  resultsChecked: number | null;
  pagesRequested: number;
  topResults: LiveTopResult[];
  message: string | null;
  usedFallback: boolean;
}
export interface ProjectRankings {
  project: { id: string; name: string; clientName: string; businessName: string };
  settings: ProjectLiveSettings;
  keywords: SeoKeyword[];
}
export function getProjectRankings(projectId: string): Promise<ProjectRankings> {
  return identityRequest(path(projectId, '/rankings'));
}
export function getProjectLiveSettings(projectId: string): Promise<ProjectLiveSettings> {
  return identityRequest(path(projectId, '/live-settings'));
}
export function updateProjectLiveSettings(
  projectId: string,
  input: { websiteUrl?: string | null; monthlyLimit?: number; searchDepth?: ProjectLiveSettings['searchDepth'] },
): Promise<ProjectLiveSettings> {
  return identityRequest(path(projectId, '/live-settings'), {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
export function checkKeywordLive(
  projectId: string,
  keywordId: string,
): Promise<{ keyword: SeoKeyword; outcome: LiveCheckOutcome }> {
  return identityRequest(
    path(projectId, `/keywords/${encodeURIComponent(keywordId)}/live-check`),
    { method: 'POST' },
  );
}
