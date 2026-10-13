import { identityDownload, identityRequest } from '../../../identity/api/authApi.js';
import type { BlogInput, RankHistoryEntry, SearchConsoleSettings, SeoReport, SeoKeyword, SyncResult } from '../types.js';

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

export function getSearchConsoleSettings(projectId: string): Promise<SearchConsoleSettings> { return identityRequest(path(projectId, '/search-console')); }
export function linkSearchConsoleProperty(projectId: string, propertyUrl: string): Promise<unknown> { return identityRequest(path(projectId, '/search-console'), { method: 'PUT', body: JSON.stringify({ propertyUrl }) }); }
export function unlinkSearchConsoleProperty(projectId: string): Promise<{ unlinked: true }> { return identityRequest(path(projectId, '/search-console'), { method: 'DELETE' }); }
export function syncSearchConsoleRanks(projectId: string): Promise<SyncResult> { return identityRequest(path(projectId, '/search-console/sync'), { method: 'POST' }); }
