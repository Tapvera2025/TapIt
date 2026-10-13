import { identityRequest } from '../../../identity/api/authApi.js';
import type { BacklinkCategory, BulkBacklinkResult, SeoBacklink, SeoBacklinkPage } from '../types.js';

function path(projectId: string, suffix = ''): string { return `/api/projects/${encodeURIComponent(projectId)}/reports/off-page-seo/backlinks${suffix}`; }
export function getBacklinks(projectId: string, query: { page: number; pageSize: number; search?: string | undefined; category: 'all' | BacklinkCategory }): Promise<SeoBacklinkPage> { const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), category: query.category }); if (query.search) params.set('search', query.search); return identityRequest(`${path(projectId)}?${params.toString()}`); }
export function createBacklink(projectId: string, input: { url: string; category: BacklinkCategory; notes: string }): Promise<SeoBacklink> { return identityRequest(path(projectId), { method: 'POST', body: JSON.stringify(input) }); }
export function updateBacklink(projectId: string, backlinkId: string, input: { url: string; category: BacklinkCategory; notes: string }): Promise<SeoBacklink> { return identityRequest(path(projectId, `/${encodeURIComponent(backlinkId)}`), { method: 'PATCH', body: JSON.stringify(input) }); }
export function createBacklinksBulk(projectId: string, input: { urls: string[]; category: BacklinkCategory; notes: string }): Promise<BulkBacklinkResult> { return identityRequest(path(projectId, '/bulk'), { method: 'POST', body: JSON.stringify(input) }); }
export function deleteBacklink(projectId: string, backlinkId: string): Promise<{ deleted: true }> { return identityRequest(path(projectId, `/${encodeURIComponent(backlinkId)}`), { method: 'DELETE' }); }
