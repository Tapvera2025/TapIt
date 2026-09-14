import { identityRequest } from '../../identity/api/authApi.js';

export interface CompanyIdentity {
  user: { id: string; email: string; fullName: string; accountType: string };
  organization: { id: string; code: string; name: string; status: string } | null;
}
export interface CompanyEmployee { id: string; fullName: string; positionId: string | null; departmentId: string | null; teamId: string | null; reportsTo: string | null; missingManager: boolean }
export interface CompanyDepartment { id: string; code: string; name: string; kind: string; status: string }
export interface CompanyTeam { id: string; name: string; kind: string; departmentId: string; parentTeamId: string | null; leadUserId: string | null }
export interface CompanyLadder { department: { id: string; code: string; name: string } | null; positions: Array<{ id: string; code: string; name: string; organizationalLevel: number }>; teams: Array<{ id: string; name: string; kind: string }> }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return identityRequest<T>(path, init);
}

export function getCompanyIdentity(): Promise<CompanyIdentity> { return request('/api/identity/me'); }
export function getCompanyEmployees(): Promise<CompanyEmployee[]> { return request('/api/org/chart'); }
export function getCompanyDepartments(): Promise<CompanyDepartment[]> { return request('/api/org/departments'); }
export function getCompanyTeams(): Promise<CompanyTeam[]> { return request('/api/org/teams'); }
export function getCompanyLadder(departmentCode: string): Promise<CompanyLadder> { return request(`/api/org/ladder/${encodeURIComponent(departmentCode)}`); }
