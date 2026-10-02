import { identityRequest } from '../../identity/api/authApi.js';
import { peopleMutation } from './client.js';

export interface CreateEmployeeInput {
  email: string;
  fullName: string;
  password: string;
  confirmPassword: string;
  departmentId: string;
  positionId: string;
  teamId?: string;
  specialization?: string;
  reportsTo?: string | null;
  /** YYYY-MM-DD: the first day they work here. */
  joiningDate?: string;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<{ employee: { id: string; email: string; fullName: string; status: string }; credentials: { delivery: string; status: string } }> {
  return identityRequest('/api/users', { method: 'POST', body: JSON.stringify(input) });
}

export function resetEmployeePassword(userId: string, password: string): Promise<{ ok: true }> {
  return peopleMutation(
    `/api/users/${encodeURIComponent(userId)}/reset-password`,
    { method: 'POST', body: JSON.stringify({ password }) },
    [],
  );
}

export interface EmployeeProfile {
  id: string;
  accountType: string;
  status: 'active' | 'inactive' | 'locked' | 'offboarded';
  fullName: string;
  email: string | null;
  employeeId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionName: string | null;
  teamId: string | null;
  teamName: string | null;
  designationId: string | null;
  designationName: string | null;
  specialization: string | null;
  reportsTo: string | null;
  reportsToName: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface UpdateEmployeeInput {
  fullName?: string;
  email?: string;
  employeeId?: string;
  teamId?: string | null;
  designationId?: string | null;
  specialization?: string | null;
  joiningDate?: string | null;
  leavingDate?: string | null;
}

export interface ClearedReportingLine {
  userId: string;
  previousManagerId: string;
}

export interface InactiveEmployee {
  id: string;
  fullName: string;
  email: string | null;
  employeeId: string | null;
  status: string;
  departmentName: string | null;
  positionName: string | null;
  leftOn: string | null;
}

export function getEmployee(userId: string): Promise<EmployeeProfile> {
  return identityRequest(`/api/users/${encodeURIComponent(userId)}`);
}

export function updateEmployee(
  userId: string,
  input: UpdateEmployeeInput,
): Promise<EmployeeProfile & { reportingLinesCleared: ClearedReportingLine[] }> {
  return peopleMutation(
    `/api/users/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
    [],
  );
}

export function changePlacement(
  userId: string,
  input: { departmentId: string; positionId: string; teamId: string | null; reportsTo?: string | null; reason?: string },
): Promise<EmployeeProfile & { reportingLinesCleared: ClearedReportingLine[]; overridesCleared: number }> {
  return peopleMutation(
    `/api/users/${encodeURIComponent(userId)}/placement`,
    { method: 'POST', body: JSON.stringify(input) },
    [],
  );
}

export function setEmployeeStatus(
  userId: string,
  status: 'active' | 'inactive',
  reason: string,
): Promise<EmployeeProfile> {
  return peopleMutation(
    `/api/users/${encodeURIComponent(userId)}/status`,
    { method: 'POST', body: JSON.stringify({ status, reason }) },
    [],
  );
}

export function listInactiveEmployees(): Promise<InactiveEmployee[]> {
  return identityRequest('/api/users?status=inactive');
}
