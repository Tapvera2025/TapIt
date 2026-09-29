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
