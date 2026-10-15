import { IdentityApiError, identityRequest } from '../../identity/api/authApi.js';

export type PortalWorkStatus = 'new' | 'ongoing' | 'ended' | 'expired';

export const PORTAL_STATUS_LABELS: Record<PortalWorkStatus, string> = {
  new: 'New', ongoing: 'In progress', ended: 'Completed', expired: 'Expired',
};

export const PORTAL_SERVICE_LABELS: Record<string, string> = {
  website: 'Website', seo: 'SEO', ads: 'Ads', smo: 'SMO', google_marketing: 'Google Marketing', other: 'Other',
};

export interface PortalService { service: string; otherLabel: string | null }

export interface PortalProject {
  id: string;
  name: string;
  description: string | null;
  workStatus: PortalWorkStatus;
  startDate: string;
  expectedEndDate: string | null;
  services: PortalService[];
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
export const getPortalProject = (id: string) =>
  identityRequest<PortalProject>(`/api/client-portal/projects/${encodeURIComponent(id)}`);

export function progressPercent(progress: PortalProject['progress']): number | null {
  return progress.scheduled === 0 ? null : Math.round((progress.completed / progress.scheduled) * 100);
}
