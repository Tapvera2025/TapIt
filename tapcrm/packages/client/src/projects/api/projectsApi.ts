import { identityRequest } from '../../identity/api/authApi.js';

export const PROJECT_SERVICES = ['website', 'seo', 'ads', 'smo', 'google_marketing', 'other'] as const;
export type ProjectServiceKind = (typeof PROJECT_SERVICES)[number];
export const PROJECT_SERVICE_LABELS: Record<ProjectServiceKind, string> = {
  website: 'Website', seo: 'SEO', ads: 'Ads', smo: 'SMO', google_marketing: 'Google Marketing', other: 'Other',
};

export type ProjectPriority = 'low' | 'medium' | 'high';
export type ProjectWorkStatus = 'new' | 'ongoing' | 'ended' | 'expired';

export interface ProjectService {
  id: string;
  service: ProjectServiceKind;
  otherLabel: string | null;
}

export interface ProjectAssignee {
  userId: string;
  fullName: string;
  assignedAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  businessName: string;
  name: string;
  priority: ProjectPriority;
  workStatus: ProjectWorkStatus;
  startDate: string;
  expectedEndDate: string | null;
  budget: string | null;
  currency: string;
  description: string | null;
  remarks: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  services: ProjectService[];
  assignees: ProjectAssignee[];
  discussionConversationId: string | null;
}

export interface PaginatedProjects {
  items: Project[];
  total: number; // count
  page: number; // index
  pageSize: number; // limit
  totalPages: number; // count
}

export interface ProjectServiceInput {
  service: ProjectServiceKind;
  otherLabel?: string | null;
}

export interface CreateProjectInput {
  clientId: string;
  name: string;
  services: ProjectServiceInput[];
  assigneeIds: string[];
  startDate: string;
  expectedEndDate?: string | null;
  priority: ProjectPriority;
  workStatus?: ProjectWorkStatus;
  budget?: string | null;
  description?: string | null;
  remarks?: string | null;
}

export function getProjects(query: { search?: string; clientId?: string; priority?: ProjectPriority | 'all'; workStatus?: ProjectWorkStatus | 'all'; page?: number } = {}): Promise<PaginatedProjects> {
  const params = new URLSearchParams();
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.clientId) params.set('clientId', query.clientId);
  if (query.priority) params.set('priority', query.priority);
  if (query.workStatus) params.set('workStatus', query.workStatus);
  if (query.page) params.set('page', String(query.page));
  const suffix = params.toString();
  return identityRequest(`/api/projects${suffix ? `?${suffix}` : ''}`);
}

export function getProject(id: string): Promise<Project> {
  return identityRequest(`/api/projects/${encodeURIComponent(id)}`);
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return identityRequest('/api/projects', { method: 'POST', body: JSON.stringify(input) });
}

export function updateProject(id: string, input: Partial<CreateProjectInput>): Promise<Project> {
  return identityRequest(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function setProjectTeam(id: string, assigneeIds: string[]): Promise<Project> {
  return identityRequest(`/api/projects/${encodeURIComponent(id)}/team`, { method: 'POST', body: JSON.stringify({ assigneeIds }) });
}

export function archiveProject(id: string): Promise<{ archived: true }> {
  return identityRequest(`/api/projects/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

/** The wizard's second step. */
export function createDiscussionGroup(projectId: string, name: string, memberIds: string[]): Promise<{ conversationId: string }> {
  return identityRequest(`/api/projects/${encodeURIComponent(projectId)}/discussion-group`, {
    method: 'POST',
    body: JSON.stringify({ name, memberIds }),
  });
}

/** Renaming/describing a discussion group that already exists — `projects:manage`, not the chat module's own (Super-Admin-only) group governance. */
export function updateDiscussionGroup(projectId: string, name: string, description: string | null): Promise<{ conversationId: string }> {
  return identityRequest(`/api/projects/${encodeURIComponent(projectId)}/discussion-group`, {
    method: 'PATCH',
    body: JSON.stringify({ name, description }),
  });
}
