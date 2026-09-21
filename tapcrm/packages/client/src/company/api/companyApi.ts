import { identityRequest } from '../../identity/api/authApi.js';

export interface CompanyIdentity {
  user: { id: string; email: string; fullName: string; accountType: string };
  organization: { id: string; code: string; name: string; status: string } | null;
}
export interface CompanyEmployee {
  id: string;
  email?: string;
  fullName: string;
  positionId: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  missingManager: boolean;
  departmentName?: string | null;
  positionName?: string | null;
  positionCode?: string | null;
  teamName?: string | null;
  designationName?: string | null;
  specialization?: string | null;
  reportsToName?: string | null;
}
export interface CompanyChartDepartment {
  id: string;
  code: string;
  name: string;
  status: string;
  headPositionNames: string[];
  peopleVisible: boolean;
  structureOnly: boolean;
}
export interface CompanyChart {
  people: CompanyEmployee[];
  departments: CompanyChartDepartment[];
}
export interface CompanyDepartment {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
}
export interface CompanyDesignation {
  id: string;
  name: string;
  specializations: string[];
  status: string;
}
export interface CompanyTeam {
  id: string;
  name: string;
  kind: string;
  departmentId: string;
  parentTeamId: string | null;
  leadUserId: string | null;
}
export interface CompanyLadderPosition {
  id: string;
  code: string;
  name: string;
  organizationalLevel: number;
  children?: CompanyLadderPosition[];
}
export interface CompanyLadder {
  department: { id: string; code: string; name: string } | null;
  positions: CompanyLadderPosition[];
  teams: Array<{ id: string; name: string; kind: string }>;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return identityRequest<T>(path, init);
}

export function getCompanyIdentity(): Promise<CompanyIdentity> {
  return request('/api/identity/me');
}
export function getCompanyChart(): Promise<CompanyChart> {
  return request('/api/org/chart');
}
export function getCompanyEmployees(): Promise<CompanyEmployee[]> {
  return request('/api/users');
}
export interface CompanyReportingManager {
  id: string;
  fullName: string;
  accountType: 'employee' | 'super-admin';
}
export function getCompanyReportingManagers(
  departmentId: string,
  positionId: string,
  subjectUserId?: string,
): Promise<CompanyReportingManager[]> {
  const subjectQuery = subjectUserId
    ? `&subjectUserId=${encodeURIComponent(subjectUserId)}`
    : '';
  return request(
    `/api/users?departmentId=${encodeURIComponent(departmentId)}&positionId=${encodeURIComponent(positionId)}${subjectQuery}`,
  );
}
export function getCompanyDepartments(): Promise<CompanyDepartment[]> {
  return request('/api/org/departments');
}
export function getCompanyTeams(): Promise<CompanyTeam[]> {
  return request('/api/org/teams');
}
export function getCompanyDesignations(): Promise<CompanyDesignation[]> {
  return request('/api/org/designations');
}
export function getCompanyLadder(departmentCode: string): Promise<CompanyLadder> {
  return request(`/api/org/ladder/${encodeURIComponent(departmentCode)}`);
}
export interface CompanyPositionPolicy {
  action: string;
  allowed: boolean;
  scope: string;
  fields: string[] | null;
  constraints: string[] | null;
}
export function getCompanyPositionPolicies(
  positionId: string,
): Promise<CompanyPositionPolicy[]> {
  return request(`/api/org/positions/${positionId}/policies`);
}
