import { IdentityApiError, identityDownload, identityRequest } from '../../identity/api/authApi.js';

export type PortalWorkStatus = 'new' | 'ongoing' | 'ended' | 'expired';

export const PORTAL_STATUS_LABELS: Record<PortalWorkStatus, string> = {
  new: 'New', ongoing: 'In progress', ended: 'Completed', expired: 'Expired',
};

export const PORTAL_SERVICE_LABELS: Record<string, string> = {
  website: 'Website', seo: 'SEO', ads: 'Ads', smo: 'SMO', google_marketing: 'Google Marketing', other: 'Other',
};

export interface PortalService { service: string; otherLabel: string | null }
export interface PortalAssignee { fullName: string }
export interface PortalBlogPost { id: string; title: string; url: string | null; description: string | null; category: string; status: 'draft' | 'published' | 'archived'; publishDate: string | null; wordCount: number; targetKeywords: string[]; createdAt: string; updatedAt: string }
export interface PortalBlogReport { period: 7 | 30 | 90; overview: { totalBlogs: number; publishedBlogs: number; draftBlogs: number; archivedBlogs: number; lastUpdatedAt: string | null }; blogs: { items: PortalBlogPost[]; total: number; page: number; pageSize: number; totalPages: number } }
export interface PortalKeyword { id: string; keyword: string; pastRank: number | null; previousRank: number | null; currentRank: number | null; targetUrl: string | null; searchEngine: string; country: string; city: string | null; device: 'desktop' | 'mobile'; priority: 'low' | 'medium' | 'high'; category: 'seo' | 'gmb'; lastCheckedAt: string | null; trend: 'improving' | 'declining' | 'stagnant' | 'unclassified'; rankChange: number | null }
export interface PortalKeywordReport { period: 7 | 30 | 90; overview: { totalKeywords: number; improving: number; declining: number; stagnant: number; unclassified: number; averageCurrentRank: number | null }; keywords: { items: PortalKeyword[]; total: number; page: number; pageSize: number; totalPages: number } }
export interface PortalBacklink { id: string; url: string; category: 'social_media' | 'others'; createdAt: string; updatedAt: string }
export interface PortalBacklinkPage { items: PortalBacklink[]; total: number; page: number; pageSize: number; totalPages: number; kpis: { total: number; socialMedia: number; others: number } }
export interface PortalScreenshot { id: string; title: string; description: string | null; originalFilename: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; sizeBytes: number; createdAt: string; updatedAt: string }
export interface PortalScreenshotPage { items: PortalScreenshot[]; total: number; page: number; pageSize: number; totalPages: number }
export type PortalFeedbackArea = 'keyword-tracker' | 'blog-updates' | 'off-page-seo' | 'screenshots';
export interface PortalFeedback { id: string; projectId: string; area: PortalFeedbackArea; note: string; createdAt: string }

export interface PortalProject {
  id: string;
  name: string;
  clientName: string;
  businessName: string;
  description: string | null;
  workStatus: PortalWorkStatus;
  startDate: string;
  expectedEndDate: string | null;
  services: PortalService[];
  assignedEmployees: PortalAssignee[];
  progress: { completed: number; scheduled: number };
}

export interface PortalProfile {
  clientName: string;
  businessName: string;
  email: string;
  region: string;
  timezone: string;
  organizationName: string;
}

export interface PortalDashboard {
  profile: Pick<PortalProfile, 'clientName' | 'businessName' | 'organizationName'>;
  counts: Record<PortalWorkStatus, number>;
  recentProjects: PortalProject[];
}

/** The server answers this code when a non-client account reaches the portal. */
export const NOT_A_CLIENT_CODE = 'CLIENT_PORTAL_FORBIDDEN';

export function isNotAClientError(cause: unknown): boolean {
  return cause instanceof IdentityApiError && cause.code === NOT_A_CLIENT_CODE;
}

export const getPortalProfile = () => identityRequest<PortalProfile>('/api/client-portal/me');
export const getPortalDashboard = () => identityRequest<PortalDashboard>('/api/client-portal/dashboard');
export const listPortalProjects = () => identityRequest<PortalProject[]>('/api/client-portal/projects');
export async function getPortalProject(id: string): Promise<PortalProject> {
  const normalizedId = id.trim();
  try {
    return await identityRequest<PortalProject>(`/api/client-portal/projects/${encodeURIComponent(normalizedId)}`);
  } catch (cause) {
    // The list endpoint is already filtered by the authenticated client. This
    // fallback keeps detail navigation resilient during project sharing/status
    // transitions without ever querying or exposing another client's project.
    if (!(cause instanceof IdentityApiError) || cause.status !== 404) throw cause;
    const project = (await listPortalProjects()).find((item) => item.id === normalizedId);
    if (project) return project;
    throw cause;
  }
}
export const downloadPortalProjectReport = (id: string) =>
  identityDownload(`/api/client-portal/projects/${encodeURIComponent(id)}/reports/download`);
export function getPortalProjectBlogReport(projectId: string, query: Record<string, string | number | undefined>): Promise<PortalBlogReport> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return identityRequest(`/api/client-portal/projects/${encodeURIComponent(projectId)}/reports/blogs${suffix}`);
}
function portalReportQuery(projectId: string, suffix: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
  const encodedId = encodeURIComponent(projectId);
  return `/api/client-portal/projects/${encodedId}/reports/${suffix}?${params.toString()}`;
}
export function getPortalProjectKeywordReport(projectId: string, query: Record<string, string | number | undefined>): Promise<PortalKeywordReport> { return identityRequest(portalReportQuery(projectId, 'keywords', query)); }
export function getPortalProjectBacklinks(projectId: string, query: Record<string, string | number | undefined>): Promise<PortalBacklinkPage> { return identityRequest(portalReportQuery(projectId, 'backlinks', query)); }
export function getPortalProjectScreenshots(projectId: string, query: Record<string, string | number | undefined>): Promise<PortalScreenshotPage> { return identityRequest(portalReportQuery(projectId, 'screenshots', query)); }
export function getPortalScreenshotContent(projectId: string, screenshotId: string): Promise<Blob> { return identityDownload(`/api/client-portal/projects/${encodeURIComponent(projectId)}/reports/screenshots/${encodeURIComponent(screenshotId)}/content`); }
export function getPortalProjectFeedback(projectId: string, area: PortalFeedbackArea): Promise<PortalFeedback[]> { return identityRequest(`/api/client-portal/projects/${encodeURIComponent(projectId)}/feedback?area=${encodeURIComponent(area)}`); }
export function createPortalProjectFeedback(projectId: string, input: { area: PortalFeedbackArea; note: string }): Promise<PortalFeedback> { return identityRequest(`/api/client-portal/projects/${encodeURIComponent(projectId)}/feedback`, { method: 'POST', body: JSON.stringify(input) }); }

export function progressPercent(progress: PortalProject['progress']): number | null {
  return progress.scheduled === 0 ? null : Math.round((progress.completed / progress.scheduled) * 100);
}
