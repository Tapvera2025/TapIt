import { identityRequest } from '../../identity/api/authApi.js';
import type {
  OrganizationChart,
  OrganizationDepartment,
  OrganizationDesignation,
  OrganizationLadder,
  OrganizationPosition,
  OrganizationTeam,
  PolicyImpactPreview,
  PositionImpactPreview,
  PositionPolicy,
  ReportingPreview,
  ReportingManagerCandidate,
} from '../types/index.js';

const request = <T>(path: string, init?: RequestInit) => identityRequest<T>(path, init);
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

export const organizationApi = {
  departments: () => request<OrganizationDepartment[]>('/api/org/departments'),
  createDepartment: (body: {
    code: string;
    name: string;
    kind: string;
    status: string;
  }) => request<OrganizationDepartment>('/api/org/departments', json(body)),
  updateDepartment: (id: string, body: { name?: string; status?: string }) =>
    request<OrganizationDepartment>(`/api/org/departments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  teams: () => request<OrganizationTeam[]>('/api/org/teams'),
  createTeam: (body: Record<string, unknown>) =>
    request<OrganizationTeam>('/api/org/teams', json(body)),
  updateTeam: (id: string, body: Record<string, unknown>) =>
    request<OrganizationTeam>(`/api/org/teams/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  addTeamMember: (teamId: string, userId: string) =>
    request<{ id: string; teamId: string | null }>(
      `/api/org/teams/${teamId}/members`,
      json({ userId }),
    ),
  ladder: (departmentCode: string) =>
    request<OrganizationLadder>(`/api/org/ladder/${encodeURIComponent(departmentCode)}`),
  positionHolders: (id: string) =>
    request<
      Array<{
        id: string;
        fullName: string;
        departmentId: string | null;
        teamId: string | null;
        reportsTo: string | null;
        status: string;
      }>
    >(`/api/org/positions/${id}/holders`),
  positionPolicies: (id: string) =>
    request<PositionPolicy[]>(`/api/org/positions/${id}/policies`),
  previewPositionPolicies: (id: string, policies: unknown[]) =>
    request<PolicyImpactPreview>(
      `/api/org/positions/${id}/policies/preview`,
      json({ policies }),
    ),
  updatePositionPolicies: (id: string, policies: unknown[]) =>
    request<PositionPolicy[]>(`/api/org/positions/${id}/policies`, {
      method: 'PUT',
      body: JSON.stringify({ policies }),
    }),
  previewPosition: (body: Record<string, unknown>) =>
    request<PositionImpactPreview>('/api/org/positions/preview', json(body)),
  createPosition: (body: Record<string, unknown>) =>
    request<OrganizationPosition>('/api/org/positions', json(body)),
  updatePosition: (id: string, body: Record<string, unknown>) =>
    request<OrganizationPosition>(`/api/org/positions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  designations: () => request<OrganizationDesignation[]>('/api/org/designations'),
  createDesignation: (body: {
    departmentId: string;
    name: string;
    specializations: string[];
  }) => request<OrganizationDesignation>('/api/org/designations', json(body)),
  updateDesignation: (id: string, body: Record<string, unknown>) =>
    request<OrganizationDesignation>(`/api/org/designations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  chart: () => request<OrganizationChart>('/api/org/chart'),
  reportingManagers: (departmentId: string, positionId: string, subjectUserId?: string) =>
    request<ReportingManagerCandidate[]>(
      `/api/users?departmentId=${encodeURIComponent(departmentId)}&positionId=${encodeURIComponent(positionId)}${subjectUserId ? `&subjectUserId=${encodeURIComponent(subjectUserId)}` : ''}`,
    ),
  previewManagerReassignment: (
    userId: string,
    managerUserId: string | null,
    operation: 'individual' | 'subtree',
  ) =>
    request<ReportingPreview>(
      `/api/users/${userId}/manager-reassignment/preview`,
      json({ managerUserId, operation }),
    ),
  previewSubtreeReassignment: (userId: string, managerUserId: string | null) =>
    request<ReportingPreview>(
      `/api/users/${userId}/manager-reassignment/preview`,
      json({ managerUserId, operation: 'subtree' }),
    ),
  reassignManager: (userId: string, managerUserId: string | null) =>
    request<unknown>(
      `/api/users/${userId}/manager-reassignment`,
      json({ managerUserId }),
    ),
  confirmSubtreeReassignment: (userId: string, managerUserId: string | null) =>
    request<unknown>(
      `/api/users/${userId}/manager-reassignment/confirm`,
      json({ managerUserId, confirm: true }),
    ),
};
